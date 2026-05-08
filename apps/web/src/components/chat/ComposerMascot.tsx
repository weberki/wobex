import { memo } from "react";
import { cn } from "~/lib/utils";

const MASCOT_PIXELS = [
  "............##",
  "............#.",
  "#..........###",
  "##........####",
  "###......#####",
  "############e#",
  ".############.",
  "..##...##.....",
  "..##...##.....",
];

const PIXEL = 3;
const COLS = MASCOT_PIXELS[0]?.length ?? 0;
const ROWS = MASCOT_PIXELS.length;
const WIDTH = COLS * PIXEL;
const HEIGHT = ROWS * PIXEL;

const EAR_ROWS = new Set([0, 1]);
const LEG_ROWS = new Set([7, 8]);
const BACK_LEG_COLS = new Set([2, 3]);
const FRONT_LEG_COLS = new Set([7, 8]);

const SCALE = 1.8;

type Rect = {
  x: number;
  y: number;
  fill: string;
  className: string | undefined;
};

function classify(y: number, x: number, ch: string): Rect | null {
  if (ch === ".") return null;
  const baseX = x * PIXEL;
  const baseY = y * PIXEL;
  if (ch === "e") {
    return {
      x: baseX,
      y: baseY,
      fill: "var(--composer-mascot-eye)",
      className: "composer-mascot-eye",
    };
  }
  if (LEG_ROWS.has(y) && BACK_LEG_COLS.has(x)) {
    return { x: baseX, y: baseY, fill: "currentColor", className: "composer-mascot-leg-a" };
  }
  if (LEG_ROWS.has(y) && FRONT_LEG_COLS.has(x)) {
    return { x: baseX, y: baseY, fill: "currentColor", className: "composer-mascot-leg-b" };
  }
  if (EAR_ROWS.has(y)) {
    return { x: baseX, y: baseY, fill: "currentColor", className: "composer-mascot-ear" };
  }
  return { x: baseX, y: baseY, fill: "currentColor", className: undefined };
}

const RECTS: readonly Rect[] = MASCOT_PIXELS.flatMap((row, y) =>
  Array.from(row).flatMap<Rect>((ch, x) => {
    const rect = classify(y, x, ch);
    return rect ? [rect] : [];
  }),
);

type ComposerMascotProps = {
  busy?: boolean;
  className?: string;
};

export const ComposerMascot = memo(function ComposerMascot({
  busy,
  className,
}: ComposerMascotProps) {
  return (
    <div
      aria-hidden="true"
      data-composer-mascot="true"
      className={cn(
        "composer-mascot-track pointer-events-none absolute -top-9 left-0 right-0 z-20 h-0 sm:-top-10",
        className,
      )}
    >
      <div
        className={cn(
          "composer-mascot absolute top-0 left-0 text-foreground/85 drop-shadow-[0_1px_0_rgba(0,0,0,0.45)]",
          busy && "composer-mascot--busy text-primary",
        )}
        style={{
          ["--composer-mascot-eye" as string]: "color-mix(in srgb, var(--primary) 50%, #fbbf24)",
          width: `${WIDTH * SCALE}px`,
          height: `${HEIGHT * SCALE}px`,
        }}
      >
        <svg
          width={WIDTH * SCALE}
          height={HEIGHT * SCALE}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          shapeRendering="crispEdges"
        >
          {RECTS.map((rect) => (
            <rect
              key={`${rect.x}-${rect.y}`}
              x={rect.x}
              y={rect.y}
              width={PIXEL}
              height={PIXEL}
              fill={rect.fill}
              className={rect.className}
            />
          ))}
        </svg>
      </div>
    </div>
  );
});
