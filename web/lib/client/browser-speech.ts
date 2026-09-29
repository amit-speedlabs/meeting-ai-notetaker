'use client';

/**
 * Wrapper around the Web Speech API (Chrome). Real speech-to-text without an API key, for microphone
 * mode only. Chrome sends the audio to Google's speech service to do this; the UI discloses it.
 */
export function browserSpeechSupported() {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export class BrowserSpeech {
  private rec: any = null;
  private active = false;
  constructor(private onFinal: (text: string, confidence: number | null) => void, private onInterim: (text: string) => void, private onError: (msg: string) => void, private lang = 'en-IN') {}

  start() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) throw new Error('Speech recognition is not supported in this browser');
    this.active = true;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.onFinal(r[0].transcript.trim(), typeof r[0].confidence === 'number' && r[0].confidence > 0 ? r[0].confidence : null);
        else interim += r[0].transcript;
      }
      this.onInterim(interim);
    };
    rec.onerror = (e: any) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.onError(e.error === 'network' ? 'Browser speech service unreachable (network)' : `Speech recognition error: ${e.error}`);
    };
    // Chrome ends recognition periodically; restart while the meeting is active.
    rec.onend = () => {
      if (this.active) setTimeout(() => this.active && this.safeStart(), 250);
    };
    this.rec = rec;
    this.safeStart();
  }
  private safeStart() {
    try {
      this.rec.start();
    } catch {
      /* already started */
    }
  }
  stop() {
    this.active = false;
    try {
      this.rec?.stop();
    } catch {}
  }
}
