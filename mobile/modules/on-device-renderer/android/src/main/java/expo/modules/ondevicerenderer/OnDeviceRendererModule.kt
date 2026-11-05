@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.ondevicerenderer

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
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
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_RENDER_CONTEXT", "The Android app context is unavailable.", null)
        return@AsyncFunction
      }
      if (activeTransformer != null) {
        promise.reject("E_RENDER_BUSY", "A video export is already running.", null)
        return@AsyncFunction
      }

      val startPositionMs = startMs.toLong()
      val endPositionMs = endMs.toLong()
      if (sourceUri.isBlank() || startPositionMs < 0 || endPositionMs <= startPositionMs) {
        promise.reject("E_RENDER_RANGE", "Choose a valid video and a trim range longer than zero.", null)
        return@AsyncFunction
      }

      val outputDirectory = File(context.cacheDir, "ai-clipper/renders")
      if (!outputDirectory.exists() && !outputDirectory.mkdirs()) {
        promise.reject("E_RENDER_STORAGE", "Could not create the temporary render folder.", null)
        return@AsyncFunction
      }
      val renderId = UUID.randomUUID().toString()
      val outputFile = File(outputDirectory, "clip-$renderId.mp4")

      try {
        val clipping = MediaItem.ClippingConfiguration.Builder()
          .setStartPositionMs(startPositionMs)
          .setEndPositionMs(endPositionMs)
          .build()
        val mediaItem = MediaItem.Builder()
          .setUri(Uri.parse(sourceUri))
          .setClippingConfiguration(clipping)
          .build()
        val portraitEffect = Presentation.createForWidthAndHeight(
          720,
          1280,
          Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP
        )
        val editedItem = EditedMediaItem.Builder(mediaItem)
          .setEffects(Effects(emptyList(), listOf(portraitEffect)))
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
              exportException: ExportException
            ) {
              if (activeRenderId != renderId) return
              outputFile.delete()
              finishActiveState()
              promise.reject(
                "E_RENDER_FAILED",
                exportException.localizedMessage ?: "The device could not export this video.",
                exportException
              )
            }
          })
          .build()

        activeTransformer = transformer
        activeOutputFile = outputFile
        activePromise = promise
        activeRenderId = renderId
        mainHandler.post {
          if (activeRenderId != renderId) return@post
          try {
            transformer.start(editedItem, outputFile.absolutePath)
            startProgressPolling(transformer, renderId)
          } catch (error: Throwable) {
            outputFile.delete()
            finishActiveState()
            promise.reject(
              "E_RENDER_START",
              error.localizedMessage ?: "The video export could not start.",
              error
            )
          }
        }
      } catch (error: Throwable) {
        outputFile.delete()
        promise.reject(
          "E_RENDER_SETUP",
          error.localizedMessage ?: "The video could not be prepared for export.",
          error
        )
      }
    }

    AsyncFunction("cancelRenderAsync") {
      val transformer = activeTransformer ?: return@AsyncFunction false
      val renderId = activeRenderId
      val outputFile = activeOutputFile
      val promise = activePromise
      mainHandler.post {
        if (activeRenderId == renderId) {
          runCatching { transformer.cancel() }
          outputFile?.delete()
          finishActiveState()
          promise?.reject("E_RENDER_CANCELLED", "The video export was cancelled.", null)
        }
      }
      true
    }
  }

  private fun startProgressPolling(transformer: Transformer, renderId: String) {
    val holder = ProgressHolder()
    val poller = object : Runnable {
      override fun run() {
        if (activeRenderId != renderId) return
        if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
          sendEvent("onRenderProgress", mapOf("progress" to holder.progress))
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
  }
}
