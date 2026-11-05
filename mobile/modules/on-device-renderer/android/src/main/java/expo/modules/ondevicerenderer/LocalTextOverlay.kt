@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.ondevicerenderer

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import androidx.media3.effect.CanvasOverlay
import org.json.JSONObject
import kotlin.math.max

internal data class LocalCaptionWord(
  val text: String,
  val startSeconds: Double,
  val endSeconds: Double,
)

internal data class LocalCaptionCue(
  val startSeconds: Double,
  val endSeconds: Double,
  val text: String,
  val words: List<LocalCaptionWord>,
)

internal data class LocalOverlayPlan(
  val captions: List<LocalCaptionCue>,
  val hookText: String,
  val watermarkText: String,
  val watermarkOpacity: Float,
) {
  val hasOverlays: Boolean
    get() = captions.isNotEmpty() || hookText.isNotBlank() || watermarkText.isNotBlank()

  companion object {
    val EMPTY = LocalOverlayPlan(emptyList(), "", "", 0.55f)

    fun fromJson(json: String, trimDurationSeconds: Double): LocalOverlayPlan {
      require(trimDurationSeconds.isFinite() && trimDurationSeconds > 0.0) {
        "Rentang klip tidak valid untuk overlay."
      }
      val root = JSONObject(json)
      val array = root.optJSONArray("captions")
      require((array?.length() ?: 0) <= 50) { "Maksimal 50 caption per render." }
      val captions = mutableListOf<LocalCaptionCue>()
      if (array != null) {
        for (index in 0 until array.length()) {
          val cue = array.optJSONObject(index)
            ?: throw IllegalArgumentException("Format caption tidak valid.")
          val start = cue.optDouble("startSeconds", Double.NaN)
          val end = cue.optDouble("endSeconds", Double.NaN)
          val text = cue.optString("text", "").trim()
          require(start.isFinite() && end.isFinite() && start >= 0.0 && end > start) {
            "Waktu caption tidak valid."
          }
          require(end <= trimDurationSeconds + 0.001) {
            "Waktu caption berada di luar klip yang akan dirender."
          }
          require(text.isNotEmpty() && text.length <= 160) { "Teks caption harus 1–160 karakter." }

          val wordArray = cue.optJSONArray("words")
          require(wordArray != null && wordArray.length() > 0) {
            "Setiap caption harus memiliki timing kata."
          }
          val words = mutableListOf<LocalCaptionWord>()
          for (wordIndex in 0 until wordArray.length()) {
            val word = wordArray.optJSONObject(wordIndex)
              ?: throw IllegalArgumentException("Format timing kata tidak valid.")
            val wordText = word.optString("text", "").trim()
            val wordStart = word.optDouble("startSeconds", Double.NaN)
            val wordEnd = word.optDouble("endSeconds", Double.NaN)
            require(
              wordText.isNotEmpty() && wordStart.isFinite() && wordEnd.isFinite() &&
                wordStart >= start - 0.001 && wordEnd > wordStart && wordEnd <= end + 0.001,
            ) { "Rentang timing kata berada di luar caption." }
            if (words.isNotEmpty()) {
              require(wordStart >= words.last().endSeconds - 0.001) {
                "Timing kata tidak boleh saling bertumpuk."
              }
            }
            words += LocalCaptionWord(wordText, wordStart, wordEnd)
          }
          require(words.joinToString(" ") { it.text } == text) {
            "Urutan timing kata harus sesuai dengan teks caption."
          }
          captions += LocalCaptionCue(start, end, text, words)
        }
      }
      captions.sortBy { it.startSeconds }
      for (index in 1 until captions.size) {
        require(captions[index].startSeconds >= captions[index - 1].endSeconds - 0.001) {
          "Waktu caption tidak boleh saling bertumpuk."
        }
      }

      val hook = root.optString("hookText", "").trim()
      val watermark = root.optString("watermarkText", "").trim()
      val opacity = root.optDouble("watermarkOpacity", 0.55).toFloat()
      require(hook.length <= 120) { "Hook maksimal 120 karakter." }
      require(watermark.length <= 40) { "Watermark maksimal 40 karakter." }
      require(opacity.isFinite() && opacity in 0.05f..1.0f) { "Opasitas watermark tidak valid." }
      return LocalOverlayPlan(captions, hook, watermark, opacity)
    }
  }
}

private data class TextLayout(val textSize: Float, val lines: List<List<String>>)

/** Draws the intentionally small, local-only text overlay subset on each exported 720x1280 frame. */
internal class LocalTextOverlay(private val plan: LocalOverlayPlan) : CanvasOverlay(false) {
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    textAlign = Paint.Align.LEFT
    color = Color.WHITE
    setShadowLayer(4f, 0f, 2f, Color.BLACK)
  }
  private val highlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(255, 229, 64) }
  private val watermarkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create("sans-serif", Typeface.BOLD)
    textAlign = Paint.Align.RIGHT
    textSize = 28f
    color = Color.WHITE
    setShadowLayer(3f, 1f, 1f, Color.BLACK)
  }
  private val hookPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    textAlign = Paint.Align.CENTER
    color = Color.WHITE
    setShadowLayer(2f, 0f, 1f, Color.BLACK)
  }
  private val hookBoxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xB8000000.toInt() }
  private val captionLayouts = plan.captions.map { cue ->
    fitText(cue.words.map { it.text }, textPaint, 58f, 28f, 640f, 3, "Caption")
  }
  private val hookLayout = plan.hookText.takeIf(String::isNotBlank)?.let { hook ->
    fitText(
      hook.replace('\n', ' ').split(Regex("\\s+")).filter(String::isNotBlank),
      hookPaint,
      46f,
      24f,
      610f,
      3,
      "Hook",
    )
  }
  private val watermarkSize = fitWatermark(plan.watermarkText)

  init {
    setCanvasSize(720, 1280)
  }

  override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
    // CanvasOverlay reuses its bitmap between frames; clear it so a previous frame's text never sticks.
    canvas.drawColor(Color.TRANSPARENT, android.graphics.PorterDuff.Mode.CLEAR)
    val timeSeconds = presentationTimeUs / 1_000_000.0

    if (plan.watermarkText.isNotBlank()) drawWatermark(canvas)
    val cueIndex = plan.captions.indexOfFirst {
      timeSeconds >= it.startSeconds && timeSeconds < it.endSeconds
    }
    if (cueIndex >= 0) drawCaption(canvas, plan.captions[cueIndex], captionLayouts[cueIndex], timeSeconds)
    if (hookLayout != null && timeSeconds in 0.0..3.0) drawHook(canvas, hookLayout)
  }

  private fun drawWatermark(canvas: Canvas) {
    watermarkPaint.textSize = watermarkSize
    watermarkPaint.alpha = (plan.watermarkOpacity * 255f).toInt().coerceIn(0, 255)
    canvas.drawText(plan.watermarkText, 684f, 1242f, watermarkPaint)
  }

  private fun drawCaption(canvas: Canvas, cue: LocalCaptionCue, layout: TextLayout, timeSeconds: Double) {
    val activeWord = cue.words.indexOfFirst {
      timeSeconds >= it.startSeconds && timeSeconds < it.endSeconds
    }
    if (activeWord < 0) return

    textPaint.textSize = layout.textSize
    val allLines = layout.lines
    val lineHeight = layout.textSize * 1.2f
    val metrics = textPaint.fontMetrics
    val firstBaseline = 982f - (allLines.size - 1) * lineHeight / 2f - (metrics.ascent + metrics.descent) / 2f
    var wordIndex = 0

    for ((lineIndex, line) in allLines.withIndex()) {
      val lineWidth = measureLine(line, textPaint)
      var x = (720f - lineWidth) / 2f
      val baseline = firstBaseline + lineIndex * lineHeight
      for (word in line) {
        val wordWidth = textPaint.measureText(word)
        val selected = wordIndex == activeWord
        if (selected) {
          canvas.drawRoundRect(
            RectF(x - 7f, baseline + metrics.ascent - 4f, x + wordWidth + 7f, baseline + metrics.descent + 3f),
            7f,
            7f,
            highlightPaint,
          )
        }
        textPaint.color = if (selected) Color.rgb(24, 22, 30) else Color.WHITE
        canvas.drawText(word, x, baseline, textPaint)
        x += wordWidth + textPaint.measureText(" ")
        wordIndex += 1
      }
    }
    textPaint.color = Color.WHITE
  }

  private fun drawHook(canvas: Canvas, layout: TextLayout) {
    hookPaint.textSize = layout.textSize
    val lineHeight = layout.textSize * 1.13f
    val top = 132f
    val width = (layout.lines.maxOf { measureLine(it, hookPaint) } + 36f).coerceAtMost(660f)
    val height = layout.lines.size * lineHeight + 22f
    canvas.drawRoundRect(RectF((720f - width) / 2f, top, (720f + width) / 2f, top + height), 14f, 14f, hookBoxPaint)
    val metrics = hookPaint.fontMetrics
    val firstBaseline = top + 11f - metrics.ascent
    for ((lineIndex, line) in layout.lines.withIndex()) {
      canvas.drawText(line.joinToString(" "), 360f, firstBaseline + lineIndex * lineHeight, hookPaint)
    }
  }

  private fun fitText(
    words: List<String>,
    paint: Paint,
    initialSize: Float,
    minimumSize: Float,
    maxWidth: Float,
    maxLines: Int,
    label: String,
  ): TextLayout {
    var size = initialSize
    var lines = wrap(words, paint, size, maxWidth)
    while ((lines.size > maxLines || !fits(lines, paint, maxWidth)) && size > minimumSize) {
      size = (size - 2f).coerceAtLeast(minimumSize)
      lines = wrap(words, paint, size, maxWidth)
    }
    require(lines.size <= maxLines && fits(lines, paint, maxWidth)) {
      "$label terlalu panjang untuk area aman. Singkatkan teks agar muat maksimal $maxLines baris."
    }
    return TextLayout(size, lines)
  }

  private fun fitWatermark(text: String): Float {
    if (text.isBlank()) return 28f
    var size = 28f
    watermarkPaint.textSize = size
    while (watermarkPaint.measureText(text) > 640f && size > 16f) {
      size -= 1f
      watermarkPaint.textSize = size
    }
    require(watermarkPaint.measureText(text) <= 640f) {
      "Watermark terlalu panjang untuk area aman. Singkatkan teksnya."
    }
    return size
  }

  private fun fits(lines: List<List<String>>, paint: Paint, maxWidth: Float): Boolean =
    lines.all { measureLine(it, paint) <= maxWidth }

  private fun measureLine(line: List<String>, paint: Paint): Float =
    line.sumOf { paint.measureText(it).toDouble() }.toFloat() +
      max(0, line.size - 1) * paint.measureText(" ")

  private fun wrap(words: List<String>, paint: Paint, size: Float, maxWidth: Float): List<List<String>> {
    paint.textSize = size
    val lines = mutableListOf<MutableList<String>>()
    var current = mutableListOf<String>()
    var width = 0f
    val space = paint.measureText(" ")
    for (word in words) {
      val wordWidth = paint.measureText(word)
      val nextWidth = if (current.isEmpty()) wordWidth else width + space + wordWidth
      if (current.isNotEmpty() && nextWidth > maxWidth) {
        lines += current
        current = mutableListOf()
        width = 0f
      }
      current += word
      width = if (current.size == 1) wordWidth else width + space + wordWidth
    }
    if (current.isNotEmpty()) lines += current
    return lines
  }
}
