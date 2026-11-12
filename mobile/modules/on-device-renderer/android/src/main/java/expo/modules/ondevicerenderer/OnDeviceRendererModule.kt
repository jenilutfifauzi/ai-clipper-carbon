@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.ondevicerenderer

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

class OnDeviceRendererModule : Module() {
  // Transformer must be created, started and cancelled on one Looper thread. Every field below is
  // read and written on the main thread only, so "is a render running" can never race.
  private val mainHandler = Handler(Looper.getMainLooper())
  private var activeTransformer: Transformer? = null
  private var activeOutputFile: File? = null
  private var activePromise: Promise? = null
  private var activeRenderId: String? = null
  private var progressRunnable: Runnable? = null

  override fun definition() = ModuleDefinition {
    Name("OnDeviceRenderer")
    Events("onRenderProgress")

    AsyncFunction("renderPortraitClipAsync") { sourceUri: String, startMs: Double, endMs: Double, promise: Promise ->
      mainHandler.post { startRender(sourceUri, startMs, endMs, null, promise) }
    }

    AsyncFunction("renderPortraitClipWithOverlaysAsync") {
        sourceUri: String,
        startMs: Double,
        endMs: Double,
        overlayPlanJson: String,
        promise: Promise ->
      mainHandler.post { startRender(sourceUri, startMs, endMs, overlayPlanJson, promise) }
    }

    AsyncFunction("cancelRenderAsync") { promise: Promise ->
      mainHandler.post { promise.resolve(cancelActiveRender()) }
    }

    OnDestroy {
      mainHandler.post { cancelActiveRender() }
    }
  }

  private fun cancelActiveRender(): Boolean {
    val transformer = activeTransformer ?: return false
    val outputFile = activeOutputFile
    val promise = activePromise
    runCatching { transformer.cancel() }
    outputFile?.delete()
    finishActiveState()
    promise?.reject("E_RENDER_CANCELLED", "The video export was cancelled.", null)
    return true
  }

  private fun startRender(
    sourceUri: String,
    startMs: Double,
    endMs: Double,
    overlayPlanJson: String?,
    promise: Promise,
  ) {
    val context = appContext.reactContext
    if (context == null) {
      promise.reject("E_RENDER_CONTEXT", "The Android app context is unavailable.", null)
      return
    }
    if (activeTransformer != null) {
      promise.reject("E_RENDER_BUSY", "A video export is already running.", null)
      return
    }

    if (!startMs.isFinite() || !endMs.isFinite()) {
      promise.reject("E_RENDER_RANGE", "Choose a valid video and a trim range longer than zero.", null)
      return
    }
    val startPositionMs = startMs.toLong()
    val endPositionMs = endMs.toLong()
    if (startPositionMs < 0 || endPositionMs <= startPositionMs) {
      promise.reject("E_RENDER_RANGE", "Choose a valid video and a trim range longer than zero.", null)
      return
    }

    // The local render promises the source never leaves the phone. Media3 would happily fetch an
    // http(s) URI, so only on-device schemes are accepted.
    val source = Uri.parse(sourceUri)
    if (source.scheme != "content" && source.scheme != "file") {
      promise.reject("E_RENDER_SOURCE", "Only videos stored on this device can be rendered.", null)
      return
    }

    val overlay = try {
      overlayPlanJson
        ?.let { LocalOverlayPlan.fromJson(it, (endMs - startMs) / 1000.0) }
        ?.takeIf { it.hasOverlays }
        ?.let(::LocalTextOverlay)
    } catch (error: Throwable) {
      promise.reject(
        "E_OVERLAY_PLAN",
        error.localizedMessage ?: "Pengaturan caption atau overlay tidak valid.",
        error,
      )
      return
    }

    val outputDirectory = File(context.cacheDir, "ai-clipper/renders")
    if (!outputDirectory.exists() && !outputDirectory.mkdirs()) {
      promise.reject("E_RENDER_STORAGE", "Could not create the temporary render folder.", null)
      return
    }
    pruneOldRenders(outputDirectory)
    val renderId = UUID.randomUUID().toString()
    val outputFile = File(outputDirectory, "clip-$renderId.mp4")

    try {
      val clipping = MediaItem.ClippingConfiguration.Builder()
        .setStartPositionMs(startPositionMs)
        .setEndPositionMs(endPositionMs)
        .build()
      val mediaItem = MediaItem.Builder()
        .setUri(source)
        .setClippingConfiguration(clipping)
        .build()
      val portraitEffect = Presentation.createForWidthAndHeight(
        720,
        1280,
        Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP,
      )
      val videoEffects = mutableListOf<Effect>(portraitEffect)
      if (overlay != null) videoEffects += OverlayEffect(listOf(overlay))
      val editedItem = EditedMediaItem.Builder(mediaItem)
        .setEffects(Effects(emptyList(), videoEffects))
        .build()
      // Phone cameras often record HDR (HLG/HDR10). The export is SDR H.264, so tone-map instead of
      // failing or producing washed-out colours.
      val composition = Composition.Builder(
        EditedMediaItemSequence.withAudioAndVideoFrom(listOf(editedItem)),
      )
        .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
        .build()

      val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            if (activeRenderId != renderId) return
            finishActiveState()
            promise.resolve(Uri.fromFile(outputFile).toString())
          }

          override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException,
          ) {
            if (activeRenderId != renderId) return
            outputFile.delete()
            finishActiveState()
            promise.reject(
              "E_RENDER_FAILED",
              exportException.localizedMessage ?: "The device could not export this video.",
              exportException,
            )
          }
        })
        .build()

      activeTransformer = transformer
      activeOutputFile = outputFile
      activePromise = promise
      activeRenderId = renderId
      setKeepScreenOn(true)
      transformer.start(composition, outputFile.absolutePath)
      startProgressPolling(transformer, renderId)
    } catch (error: Throwable) {
      outputFile.delete()
      finishActiveState()
      promise.reject(
        "E_RENDER_SETUP",
        error.localizedMessage ?: "The video could not be prepared for export.",
        error,
      )
    }
  }

  /** Finished clips are private user video; keep only the newest one (it may still be shared). */
  private fun pruneOldRenders(directory: File) {
    val renders = directory.listFiles { file -> file.isFile }?.sortedByDescending { it.lastModified() }
      ?: return
    renders.drop(1).forEach { it.delete() }
  }

  private fun setKeepScreenOn(enabled: Boolean) {
    val window = appContext.currentActivity?.window ?: return
    if (enabled) {
      window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    } else {
      window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  private fun startProgressPolling(transformer: Transformer, renderId: String) {
    val holder = ProgressHolder()
    var lastProgress = -1
    val poller = object : Runnable {
      override fun run() {
        if (activeRenderId != renderId) return
        if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE &&
          holder.progress != lastProgress
        ) {
          lastProgress = holder.progress
          sendEvent("onRenderProgress", mapOf("progress" to lastProgress))
        }
        mainHandler.postDelayed(this, 300)
      }
    }
    progressRunnable = poller
    mainHandler.post(poller)
  }

  private fun finishActiveState() {
    progressRunnable?.let(mainHandler::removeCallbacks)
    progressRunnable = null
    activeTransformer = null
    activeOutputFile = null
    activePromise = null
    activeRenderId = null
    setKeepScreenOn(false)
  }
}
