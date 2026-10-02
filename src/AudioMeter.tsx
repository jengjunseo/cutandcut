import { useEffect, useState } from 'react';
import type { AudioPreview } from './audio-preview';
export default function AudioMeter({ audio }: { audio: AudioPreview }) {
  const [peak, setPeak] = useState(0);
  useEffect(() => {
    const data = new Float32Array(2048);
    const timer = setInterval(() => {
      if (!audio.analyser) {
        setPeak(0);
        return;
      }
      audio.analyser.getFloatTimeDomainData(data);
      let value = 0;
      for (const sample of data) value = Math.max(value, Math.abs(sample));
      setPeak(value);
    }, 100);
    return () => clearInterval(timer);
  }, [audio]);
  const db = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
  return (
    <div
      className={`audio-meter ${peak >= 1 ? 'clipping' : ''}`}
      aria-label={`출력 음량 ${db.toFixed(1)} dBFS`}
      title="실시간 피크 · 전체 음량 검사는 프로젝트 메뉴"
    >
      <meter min={-60} max={0} low={-12} high={-1} optimum={-6} value={db} />
      <span>{peak >= 1 ? '클리핑' : db <= -60 ? '−∞ dB' : `${db.toFixed(1)} dB`}</span>
    </div>
  );
}
