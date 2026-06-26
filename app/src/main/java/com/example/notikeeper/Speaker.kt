package com.example.notikeeper

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Eyes-free read-aloud for riders. Wraps Android TextToSpeech and ducks any
 * playing music while speaking (transient audio focus), so a spoken alert dips
 * the music like a GPS prompt and then restores it.
 */
object Speaker {

    private var tts: TextToSpeech? = null
    private var ready = false
    private var audio: AudioManager? = null
    private var focusRequest: AudioFocusRequest? = null

    @Synchronized
    fun init(context: Context) {
        if (tts != null) return
        val appCtx = context.applicationContext
        audio = appCtx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        tts = TextToSpeech(appCtx) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val engine = tts ?: return@TextToSpeech
                val res = engine.setLanguage(Locale("th", "TH"))
                if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                    engine.setLanguage(Locale.getDefault())
                }
                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = requestDuck()
                    override fun onDone(utteranceId: String?) = abandonDuck()
                    @Deprecated("legacy") override fun onError(utteranceId: String?) = abandonDuck()
                })
                ready = true
            }
        }
    }

    fun speak(context: Context, text: String) {
        val clean = text.trim()
        if (clean.isBlank()) return
        init(context)
        val engine = tts ?: return
        if (!ready) return
        engine.speak(clean, TextToSpeech.QUEUE_ADD, null, "u" + clean.hashCode())
    }

    private fun requestDuck() {
        val am = audio ?: return
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs)
            .build()
        focusRequest = req
        am.requestAudioFocus(req)
    }

    private fun abandonDuck() {
        val am = audio ?: return
        focusRequest?.let { am.abandonAudioFocusRequest(it) }
        focusRequest = null
    }
}
