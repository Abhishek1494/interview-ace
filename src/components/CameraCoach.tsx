import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2 } from "lucide-react";

import type { PresenceReading } from "@/lib/interview-core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  sessionId: string;
  lastAnswer: string;
  paused: boolean;
  onReading?: (r: PresenceReading) => void;
};

const INTERVAL_MS = 25000;

/**
 * Opt-in webcam coach: samples two stills every ~25s while the interview is live
 * and asks the agent for a body-language read. Frames are sent for analysis and
 * never stored.
 */
export function CameraCoach({ sessionId, lastAnswer, paused, onReading }: Props) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [reading, setReading] = useState<PresenceReading | null>(null);
  const [count, setCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const answerRef = useRef(lastAnswer);
  answerRef.current = lastAnswer;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const busyRef = useRef(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  async function enable() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      setOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError("Camera permission denied — the interview works fine without it.");
    }
  }

  const grab = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 384);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  }, []);

  useEffect(() => {
    if (!on || !sessionId) return;

    async function sample() {
      if (busyRef.current || pausedRef.current) return;
      const first = grab();
      if (!first) return;
      busyRef.current = true;
      setAnalyzing(true);
      await new Promise((r) => setTimeout(r, 2500));
      const frames = [first, grab()].filter(Boolean) as string[];
      try {
        const res = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, frames, answer: answerRef.current }),
        });
        const data = (await res.json()) as { reading?: PresenceReading; error?: string };
        if (data.reading) {
          setReading(data.reading);
          setCount((c) => c + 1);
          onReading?.(data.reading);
        } else if (data.error) {
          setError(data.error);
        }
      } catch {
        setError("Could not reach the presence analyser.");
      } finally {
        busyRef.current = false;
        setAnalyzing(false);
      }
    }

    const t = setTimeout(() => void sample(), 6000);
    const i = setInterval(() => void sample(), INTERVAL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [on, sessionId, grab, onReading]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Presence coach
        </h3>
        <Button
          size="sm"
          variant={on ? "secondary" : "outline"}
          className="h-7 gap-1.5 text-[11px]"
          onClick={() => (on ? stop() : void enable())}
        >
          {on ? <CameraOff className="size-3.5" /> : <Camera className="size-3.5" />}
          {on ? "Turn off" : "Turn on camera"}
        </Button>
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-lg border border-border/70 bg-background/60",
          !on && "hidden",
        )}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          className="aspect-video w-full scale-x-[-1] object-cover"
        />
        {analyzing && (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] text-primary">
            <Loader2 className="size-3 animate-spin" /> reading
          </span>
        )}
      </div>

      {!on && !error && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Optional. Ada watches posture, eye contact and gestures to coach your delivery, and folds
          it into the final feedback. Frames are analysed live and never stored.
        </p>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {reading && (
        <div className="space-y-2 rounded-lg border border-border/70 bg-background/40 p-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="uppercase tracking-wide text-muted-foreground">Confidence</span>
            <span className="font-display">{reading.confidence}/100</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(0, reading.confidence))}%` }}
            />
          </div>
          <dl className="grid grid-cols-2 gap-1.5 text-[11px]">
            {(
              [
                ["Posture", reading.posture],
                ["Eye contact", reading.eyeContact],
                ["Gestures", reading.gestures],
                ["Energy", reading.energy],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="leading-snug">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] leading-relaxed text-primary">{reading.note}</p>
          <p className="text-[10px] text-muted-foreground">{count} read(s) this session</p>
        </div>
      )}
    </div>
  );
}
