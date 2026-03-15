"use client";

import { localPoint } from "@visx/event";
import { curveMonotoneX } from "@visx/curve";
import { GridColumns, GridRows } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime, type scaleBand } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { bisector } from "d3-array";
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useSpring,
} from "motion/react";
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import useMeasure from "react-use-measure";
import { createPortal } from "react-dom";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// ─── Utils ───────────────────────────────────────────────────────────────────

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Chart Context ───────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: d3 curve factory type
type CurveFactory = any;

type ScaleLinearType<Output, _Input = number> = ReturnType<typeof scaleLinear<Output>>;
type ScaleTimeType<Output, _Input = Date | number> = ReturnType<typeof scaleTime<Output>>;
type ScaleBandType<Domain extends { toString(): string }> = ReturnType<typeof scaleBand<Domain>>;

export const chartCssVars = {
  background: "var(--chart-background)",
  foreground: "var(--chart-foreground)",
  foregroundMuted: "var(--chart-foreground-muted)",
  label: "var(--chart-label)",
  linePrimary: "var(--chart-line-primary)",
  lineSecondary: "var(--chart-line-secondary)",
  crosshair: "var(--chart-crosshair)",
  grid: "var(--chart-grid)",
  indicatorColor: "var(--chart-indicator-color)",
  indicatorSecondaryColor: "var(--chart-indicator-secondary-color)",
  markerBackground: "var(--chart-marker-background)",
  markerBorder: "var(--chart-marker-border)",
  markerForeground: "var(--chart-marker-foreground)",
  badgeBackground: "var(--chart-marker-badge-background)",
  badgeForeground: "var(--chart-marker-badge-foreground)",
  segmentBackground: "var(--chart-segment-background)",
  segmentLine: "var(--chart-segment-line)",
};

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TooltipData {
  point: Record<string, unknown>;
  index: number;
  x: number;
  yPositions: Record<string, number>;
  xPositions?: Record<string, number>;
}

export interface LineConfig {
  dataKey: string;
  stroke: string;
  strokeWidth: number;
}

export interface ChartSelection {
  startX: number;
  endX: number;
  startIndex: number;
  endIndex: number;
  active: boolean;
}

export interface ChartContextValue {
  data: Record<string, unknown>[];
  xScale: ScaleTimeType<number, number>;
  yScale: ScaleLinearType<number, number>;
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
  margin: Margin;
  columnWidth: number;
  tooltipData: TooltipData | null;
  setTooltipData: Dispatch<SetStateAction<TooltipData | null>>;
  containerRef: RefObject<HTMLDivElement | null>;
  lines: LineConfig[];
  isLoaded: boolean;
  animationDuration: number;
  xAccessor: (d: Record<string, unknown>) => Date;
  dateLabels: string[];
  selection?: ChartSelection | null;
  clearSelection?: () => void;
  barScale?: ScaleBandType<string>;
  bandWidth?: number;
  hoveredBarIndex?: number | null;
  setHoveredBarIndex?: (index: number | null) => void;
  barXAccessor?: (d: Record<string, unknown>) => string;
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
  stackOffsets?: Map<number, Map<string, number>>;
}

const ChartContext = createContext<ChartContextValue | null>(null);

function ChartProvider({ children, value }: { children: ReactNode; value: ChartContextValue }) {
  return <ChartContext.Provider value={value}>{children}</ChartContext.Provider>;
}

function useChart(): ChartContextValue {
  const context = useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a ChartProvider.");
  }
  return context;
}

// ─── useChartInteraction ─────────────────────────────────────────────────────

type ScaleTime = ReturnType<typeof scaleTime<number>>;
type ScaleLinear = ReturnType<typeof scaleLinear<number>>;

interface UseChartInteractionParams {
  xScale: ScaleTime;
  yScale: ScaleLinear;
  data: Record<string, unknown>[];
  lines: LineConfig[];
  margin: Margin;
  xAccessor: (d: Record<string, unknown>) => Date;
  bisectDate: (data: Record<string, unknown>[], date: Date, lo: number) => number;
  canInteract: boolean;
}

interface ChartInteractionResult {
  tooltipData: TooltipData | null;
  setTooltipData: Dispatch<SetStateAction<TooltipData | null>>;
  selection: ChartSelection | null;
  clearSelection: () => void;
  interactionHandlers: {
    onMouseMove?: (event: React.MouseEvent<SVGRectElement>) => void;
    onMouseLeave?: () => void;
    onTouchStart?: (event: React.TouchEvent<SVGRectElement>) => void;
    onTouchMove?: (event: React.TouchEvent<SVGRectElement>) => void;
    onTouchEnd?: () => void;
  };
  interactionStyle: React.CSSProperties;
}

function useChartInteraction({
  xScale, yScale, data, lines, margin, xAccessor, bisectDate, canInteract,
}: UseChartInteractionParams): ChartInteractionResult {
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [selection, setSelection] = useState<ChartSelection | null>(null);

  const resolveTooltipFromX = useCallback((pixelX: number): TooltipData | null => {
    const x0 = xScale.invert(pixelX);
    const index = bisectDate(data, x0, 1);
    const d0 = data[index - 1];
    const d1 = data[index];
    if (!d0) return null;
    let d = d0;
    let finalIndex = index - 1;
    if (d1) {
      const d0Time = xAccessor(d0).getTime();
      const d1Time = xAccessor(d1).getTime();
      if (x0.getTime() - d0Time > d1Time - x0.getTime()) { d = d1; finalIndex = index; }
    }
    const yPositions: Record<string, number> = {};
    for (const line of lines) {
      const value = d[line.dataKey];
      if (typeof value === "number") yPositions[line.dataKey] = yScale(value) ?? 0;
    }
    return { point: d, index: finalIndex, x: xScale(xAccessor(d)) ?? 0, yPositions };
  }, [xScale, yScale, data, lines, xAccessor, bisectDate]);

  const getChartX = useCallback((event: React.MouseEvent<SVGRectElement> | React.TouchEvent<SVGRectElement>, touchIndex = 0): number | null => {
    let point: { x: number; y: number } | null = null;
    if ("touches" in event) {
      const touch = event.touches[touchIndex];
      if (!touch) return null;
      const svg = (event.currentTarget as SVGRectElement).ownerSVGElement;
      if (!svg) return null;
      point = localPoint(svg, touch as unknown as MouseEvent);
    } else {
      point = localPoint(event as unknown as MouseEvent);
    }
    if (!point) return null;
    return point.x - margin.left;
  }, [margin.left]);

  const handleMouseMove = useCallback((event: React.MouseEvent<SVGRectElement>) => {
    const chartX = getChartX(event);
    if (chartX === null) return;
    const tooltip = resolveTooltipFromX(chartX);
    if (tooltip) setTooltipData(tooltip);
  }, [getChartX, resolveTooltipFromX]);

  const handleMouseLeave = useCallback(() => { setTooltipData(null); setSelection(null); }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent<SVGRectElement>) => {
    if (event.touches.length === 1) {
      event.preventDefault();
      const chartX = getChartX(event, 0);
      if (chartX === null) return;
      const tooltip = resolveTooltipFromX(chartX);
      if (tooltip) setTooltipData(tooltip);
    }
  }, [getChartX, resolveTooltipFromX]);

  const handleTouchMove = useCallback((event: React.TouchEvent<SVGRectElement>) => {
    if (event.touches.length === 1) {
      event.preventDefault();
      const chartX = getChartX(event, 0);
      if (chartX === null) return;
      const tooltip = resolveTooltipFromX(chartX);
      if (tooltip) setTooltipData(tooltip);
    }
  }, [getChartX, resolveTooltipFromX]);

  const handleTouchEnd = useCallback(() => { setTooltipData(null); setSelection(null); }, []);
  const clearSelection = useCallback(() => { setSelection(null); }, []);

  const interactionHandlers = canInteract ? {
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  } : {};

  const interactionStyle: React.CSSProperties = { cursor: canInteract ? "crosshair" : "default", touchAction: "none" };

  return { tooltipData, setTooltipData, selection, clearSelection, interactionHandlers, interactionStyle };
}

// ─── TooltipDot ──────────────────────────────────────────────────────────────

interface TooltipDotProps {
  x: number; y: number; visible: boolean; color: string;
  size?: number; strokeColor?: string; strokeWidth?: number;
}

function TooltipDot({ x, y, visible, color, size = 5, strokeColor = chartCssVars.background, strokeWidth = 2 }: TooltipDotProps) {
  const cfg = { stiffness: 300, damping: 30 };
  const animX = useSpring(x, cfg);
  const animY = useSpring(y, cfg);
  useEffect(() => { animX.set(x); animY.set(y); }, [x, y, animX, animY]);
  if (!visible) return null;
  return <motion.circle cx={animX} cy={animY} fill={color} r={size} stroke={strokeColor} strokeWidth={strokeWidth} />;
}
TooltipDot.displayName = "TooltipDot";

// ─── TooltipIndicator ────────────────────────────────────────────────────────

type IndicatorWidth = number | "line" | "thin" | "medium" | "thick";

interface TooltipIndicatorProps {
  x: number; height: number; visible: boolean; width?: IndicatorWidth;
  colorEdge?: string; colorMid?: string; fadeEdges?: boolean; gradientId?: string;
}

function resolveWidth(w: IndicatorWidth): number {
  if (typeof w === "number") return w;
  return w === "line" ? 1 : w === "thin" ? 2 : w === "medium" ? 4 : 8;
}

function TooltipIndicator({
  x, height, visible, width = "line",
  colorEdge = chartCssVars.crosshair, colorMid = chartCssVars.crosshair,
  fadeEdges = true, gradientId = "tooltip-indicator-gradient",
}: TooltipIndicatorProps) {
  const pw = resolveWidth(width);
  const cfg = { stiffness: 300, damping: 30 };
  const animX = useSpring(x - pw / 2, cfg);
  useEffect(() => { animX.set(x - pw / 2); }, [x, animX, pw]);
  if (!visible) return null;
  const eo = fadeEdges ? 0 : 1;
  return (
    <g>
      <defs>
        <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: colorEdge, stopOpacity: eo }} />
          <stop offset="10%" style={{ stopColor: colorEdge, stopOpacity: 1 }} />
          <stop offset="50%" style={{ stopColor: colorMid, stopOpacity: 1 }} />
          <stop offset="90%" style={{ stopColor: colorEdge, stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: colorEdge, stopOpacity: eo }} />
        </linearGradient>
      </defs>
      <motion.rect fill={`url(#${gradientId})`} height={height} width={pw} x={animX} y={0} />
    </g>
  );
}
TooltipIndicator.displayName = "TooltipIndicator";

// ─── TooltipContent ──────────────────────────────────────────────────────────

export interface TooltipRow { color: string; label: string; value: string | number; }

interface TooltipContentProps { title?: string; rows: TooltipRow[]; children?: ReactNode; }

function TooltipContent({ title, rows, children }: TooltipContentProps) {
  return (
    <div className="px-3 py-2.5">
      {title && <div className="mb-2 font-medium text-chart-tooltip-foreground text-xs">{title}</div>}
      <div className="space-y-1.5">
        {rows.map(row => (
          <div className="flex items-center justify-between gap-4" key={`${row.label}-${row.color}`}>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="text-chart-tooltip-muted text-sm">{row.label}</span>
            </div>
            <span className="font-medium text-chart-tooltip-foreground text-sm tabular-nums">
              {typeof row.value === "number" ? row.value.toLocaleString() : row.value}
            </span>
          </div>
        ))}
      </div>
      <AnimatePresence mode="wait">
        {children && (
          <motion.div animate={{ opacity: 1, filter: "blur(0px)" }} className="mt-2"
            exit={{ opacity: 0, filter: "blur(4px)" }} initial={{ opacity: 0, filter: "blur(4px)" }}
            transition={{ duration: 0.2, ease: "easeOut" }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
TooltipContent.displayName = "TooltipContent";

// ─── TooltipBox ──────────────────────────────────────────────────────────────

interface TooltipBoxProps {
  x: number; y: number; visible: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  containerWidth: number; containerHeight: number;
  offset?: number; className?: string; children: ReactNode;
}

function TooltipBox({ x, y, visible, containerRef, containerWidth, containerHeight, offset = 16, className = "", children }: TooltipBoxProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipWidth, setTooltipWidth] = useState(180);
  const [tooltipHeight, setTooltipHeight] = useState(80);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useLayoutEffect(() => {
    if (tooltipRef.current) {
      const w = tooltipRef.current.offsetWidth;
      const h = tooltipRef.current.offsetHeight;
      if (w > 0 && w !== tooltipWidth) setTooltipWidth(w);
      if (h > 0 && h !== tooltipHeight) setTooltipHeight(h);
    }
  }, [tooltipWidth, tooltipHeight]);

  const shouldFlipX = x + tooltipWidth + offset > containerWidth;
  const targetX = shouldFlipX ? x - offset - tooltipWidth : x + offset;
  const targetY = Math.max(offset, Math.min(y - tooltipHeight / 2, containerHeight - tooltipHeight - offset));

  const prevFlipRef = useRef(shouldFlipX);
  const [flipKey, setFlipKey] = useState(0);
  useEffect(() => {
    if (prevFlipRef.current !== shouldFlipX) { setFlipKey(k => k + 1); prevFlipRef.current = shouldFlipX; }
  }, [shouldFlipX]);

  const springConfig = { stiffness: 100, damping: 20 };
  const animLeft = useSpring(targetX, springConfig);
  const animTop = useSpring(targetY, springConfig);
  useEffect(() => { animLeft.set(targetX); }, [targetX, animLeft]);
  useEffect(() => { animTop.set(targetY); }, [targetY, animTop]);

  const container = containerRef.current;
  if (!(mounted && container) || !visible) return null;

  return createPortal(
    <motion.div animate={{ opacity: 1 }} className={cn("pointer-events-none absolute z-50", className)}
      exit={{ opacity: 0 }} initial={{ opacity: 0 }} ref={tooltipRef}
      style={{ left: animLeft, top: animTop }} transition={{ duration: 0.1 }}>
      <motion.div animate={{ scale: 1, opacity: 1, x: 0 }}
        className="min-w-[140px] overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-lg backdrop-blur-md"
        initial={{ scale: 0.85, opacity: 0, x: shouldFlipX ? 20 : -20 }} key={flipKey}
        style={{ transformOrigin: shouldFlipX ? "right top" : "left top" }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}>
        {children}
      </motion.div>
    </motion.div>,
    container
  );
}
TooltipBox.displayName = "TooltipBox";

// ─── ChartTooltip ────────────────────────────────────────────────────────────

export interface ChartTooltipProps {
  showCrosshair?: boolean;
  showDots?: boolean;
  content?: (props: { point: Record<string, unknown>; index: number }) => ReactNode;
  rows?: (point: Record<string, unknown>) => TooltipRow[];
  children?: ReactNode;
  className?: string;
}

export function ChartTooltip({ showCrosshair = true, showDots = true, content, rows: rowsRenderer, children, className = "" }: ChartTooltipProps) {
  const { tooltipData, width, height, innerHeight, margin, columnWidth, lines, xAccessor, containerRef } = useChart();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const visible = tooltipData !== null;
  const x = tooltipData?.x ?? 0;
  const xWithMargin = x + margin.left;
  const firstLineDataKey = lines[0]?.dataKey;
  const firstLineY = firstLineDataKey ? (tooltipData?.yPositions[firstLineDataKey] ?? 0) : 0;

  const cfg = { stiffness: 300, damping: 30 };
  const animX = useSpring(xWithMargin, cfg);
  useEffect(() => { animX.set(xWithMargin); }, [xWithMargin, animX]);

  const tooltipRows = useMemo(() => {
    if (!tooltipData) return [];
    if (rowsRenderer) return rowsRenderer(tooltipData.point);
    return lines.map(line => ({ color: line.stroke, label: line.dataKey, value: (tooltipData.point[line.dataKey] as number) ?? 0 }));
  }, [tooltipData, lines, rowsRenderer]);

  const title = useMemo(() => {
    if (!tooltipData) return undefined;
    return xAccessor(tooltipData.point).toLocaleDateString("pt-BR", { weekday: "short", month: "short", day: "numeric" });
  }, [tooltipData, xAccessor]);

  const container = containerRef.current;
  if (!(mounted && container)) return null;

  return createPortal(
    <>
      {showCrosshair && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0" height="100%" width="100%">
          <g transform={`translate(${margin.left},${margin.top})`}>
            <TooltipIndicator colorEdge={chartCssVars.crosshair} colorMid={chartCssVars.crosshair}
              fadeEdges height={innerHeight} visible={visible} width="line" x={x} />
          </g>
        </svg>
      )}
      {showDots && visible && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0" height="100%" width="100%">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {lines.map(line => (
              <TooltipDot color={line.stroke} key={line.dataKey} strokeColor={chartCssVars.background}
                visible={visible} x={x} y={tooltipData?.yPositions[line.dataKey] ?? 0} />
            ))}
          </g>
        </svg>
      )}
      <TooltipBox className={className} containerHeight={height} containerRef={containerRef}
        containerWidth={width} visible={visible} x={xWithMargin} y={firstLineY + margin.top}>
        {content
          ? content({ point: tooltipData?.point ?? {}, index: tooltipData?.index ?? 0 })
          : <TooltipContent rows={tooltipRows} title={title}>{children}</TooltipContent>
        }
      </TooltipBox>
    </>,
    container
  );
}
ChartTooltip.displayName = "ChartTooltip";

// ─── Grid ────────────────────────────────────────────────────────────────────

export interface GridProps {
  horizontal?: boolean; vertical?: boolean;
  numTicksRows?: number; numTicksColumns?: number;
  stroke?: string; strokeOpacity?: number; strokeWidth?: number; strokeDasharray?: string;
}

export function Grid({
  horizontal = true, vertical = false,
  numTicksRows = 5, numTicksColumns = 10,
  stroke = chartCssVars.grid, strokeOpacity = 1, strokeWidth = 1, strokeDasharray = "4,4",
}: GridProps) {
  const { xScale, yScale, innerWidth, innerHeight } = useChart();
  const uniqueId = useId();
  const hMaskId = `grid-rows-fade-${uniqueId}`;
  const hGradientId = `${hMaskId}-gradient`;

  return (
    <g className="chart-grid">
      <defs>
        <linearGradient id={hGradientId} x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" style={{ stopColor: "white", stopOpacity: 0 }} />
          <stop offset="10%" style={{ stopColor: "white", stopOpacity: 1 }} />
          <stop offset="90%" style={{ stopColor: "white", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "white", stopOpacity: 0 }} />
        </linearGradient>
        <mask id={hMaskId}>
          <rect fill={`url(#${hGradientId})`} height={innerHeight} width={innerWidth} x="0" y="0" />
        </mask>
      </defs>
      {horizontal && (
        <g mask={`url(#${hMaskId})`}>
          <GridRows numTicks={numTicksRows} scale={yScale} stroke={stroke}
            strokeDasharray={strokeDasharray} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth} width={innerWidth} />
        </g>
      )}
      {vertical && (
        <GridColumns height={innerHeight} numTicks={numTicksColumns} scale={xScale} stroke={stroke}
          strokeDasharray={strokeDasharray} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth} />
      )}
    </g>
  );
}
Grid.displayName = "Grid";

// ─── XAxis ───────────────────────────────────────────────────────────────────

export interface XAxisProps { numTicks?: number; }

export function XAxis({ numTicks = 5 }: XAxisProps) {
  const { xScale, margin, tooltipData, containerRef } = useChart();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const labelsToShow = useMemo(() => {
    const domain = xScale.domain();
    const startDate = domain[0]; const endDate = domain[1];
    if (!(startDate && endDate)) return [];
    const startTime = startDate.getTime(); const endTime = endDate.getTime();
    const timeRange = endTime - startTime;
    const tickCount = Math.max(2, numTicks);
    const dates: Date[] = [];
    for (let i = 0; i < tickCount; i++) {
      dates.push(new Date(startTime + (i / (tickCount - 1)) * timeRange));
    }
    return dates.map(date => ({
      date, x: (xScale(date) ?? 0) + margin.left,
      label: date.toLocaleDateString("pt-BR", { month: "short", day: "numeric" }),
    }));
  }, [xScale, margin.left, numTicks]);

  const isHovering = tooltipData !== null;
  const crosshairX = tooltipData ? tooltipData.x + margin.left : null;

  const container = containerRef.current;
  if (!(mounted && container)) return null;

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {labelsToShow.map(item => {
        let opacity = 1;
        if (isHovering && crosshairX !== null) {
          const dist = Math.abs(item.x - crosshairX);
          if (dist < 50) opacity = 0;
          else if (dist < 70) opacity = (dist - 50) / 20;
        }
        return (
          <div className="absolute" key={`${item.label}-${item.x}`}
            style={{ left: item.x, bottom: 12, width: 0, display: "flex", justifyContent: "center" }}>
            <motion.span animate={{ opacity }} className="whitespace-nowrap text-chart-label text-xs"
              initial={{ opacity: 1 }} transition={{ duration: 0.4, ease: "easeInOut" }}>
              {item.label}
            </motion.span>
          </div>
        );
      })}
    </div>,
    container
  );
}
XAxis.displayName = "XAxis";

// ─── YAxis ───────────────────────────────────────────────────────────────────

export interface YAxisProps { numTicks?: number; formatValue?: (value: number) => string; }

export function YAxis({ numTicks = 5, formatValue }: YAxisProps) {
  const { yScale, margin, containerRef } = useChart();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => { setContainer(containerRef.current); }, [containerRef]);

  const ticks = useMemo(() => {
    const domain = yScale.domain() as [number, number];
    const min = domain[0]; const max = domain[1];
    const step = (max - min) / (numTicks - 1);
    return Array.from({ length: numTicks }, (_, i) => {
      const value = min + step * i;
      return {
        value, y: (yScale(value) ?? 0) + margin.top,
        label: formatValue ? formatValue(value) : value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toLocaleString(),
      };
    });
  }, [yScale, margin.top, numTicks, formatValue]);

  if (!container) return null;

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {ticks.map(tick => (
        <div key={tick.value} className="absolute"
          style={{ left: 0, top: tick.y, width: margin.left - 8, display: "flex", justifyContent: "flex-end", transform: "translateY(-50%)" }}>
          <span className="whitespace-nowrap text-chart-label text-xs tabular-nums">{tick.label}</span>
        </div>
      ))}
    </div>,
    container
  );
}
YAxis.displayName = "YAxis";

// ─── Area ────────────────────────────────────────────────────────────────────

export interface AreaProps {
  dataKey: string;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  curve?: CurveFactory;
  animate?: boolean;
  showLine?: boolean;
  gradientToOpacity?: number;
}

export function Area({
  dataKey,
  fill = chartCssVars.linePrimary,
  fillOpacity = 0.25,
  stroke,
  strokeWidth = 2,
  curve = curveMonotoneX,
  animate = true,
  showLine = true,
  gradientToOpacity = 0,
}: AreaProps) {
  const { data, xScale, yScale, innerHeight, innerWidth, isLoaded, animationDuration, xAccessor } = useChart();

  const pathRef = useRef<SVGPathElement>(null);
  const [clipWidth, setClipWidth] = useState(0);

  const uniqueId = useId();
  const gradientId = `area-gradient-${dataKey}-${uniqueId}`;
  const strokeGradientId = `area-stroke-gradient-${dataKey}-${uniqueId}`;
  const resolvedStroke = stroke || fill;

  useEffect(() => {
    if (animate && !isLoaded) {
      requestAnimationFrame(() => { setClipWidth(innerWidth); });
    }
  }, [animate, innerWidth, isLoaded]);

  const getY = useCallback((d: Record<string, unknown>) => {
    const value = d[dataKey];
    return typeof value === "number" ? (yScale(value) ?? 0) : 0;
  }, [dataKey, yScale]);

  const easing = "cubic-bezier(0.85, 0, 0.15, 1)";

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: fill, stopOpacity: fillOpacity }} />
          <stop offset="100%" style={{ stopColor: fill, stopOpacity: gradientToOpacity }} />
        </linearGradient>
        <linearGradient id={strokeGradientId} x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" style={{ stopColor: resolvedStroke, stopOpacity: 0 }} />
          <stop offset="15%" style={{ stopColor: resolvedStroke, stopOpacity: 1 }} />
          <stop offset="85%" style={{ stopColor: resolvedStroke, stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: resolvedStroke, stopOpacity: 0 }} />
        </linearGradient>
      </defs>

      {animate && (
        <defs>
          <clipPath id={`grow-clip-area-${dataKey}-${uniqueId}`}>
            <rect height={innerHeight + 20}
              style={{ transition: !isLoaded && clipWidth > 0 ? `width ${animationDuration}ms ${easing}` : "none" }}
              width={isLoaded ? innerWidth : clipWidth} x={0} y={0} />
          </clipPath>
        </defs>
      )}

      <g clipPath={animate ? `url(#grow-clip-area-${dataKey}-${uniqueId})` : undefined}>
        <AreaClosed curve={curve} data={data} fill={`url(#${gradientId})`}
          x={d => xScale(xAccessor(d)) ?? 0} y={getY} yScale={yScale} />
        {showLine && (
          <LinePath curve={curve} data={data} innerRef={pathRef}
            stroke={`url(#${strokeGradientId})`} strokeLinecap="round" strokeWidth={strokeWidth}
            x={d => xScale(xAccessor(d)) ?? 0} y={getY} />
        )}
      </g>
    </>
  );
}
Area.displayName = "Area";

// ─── AreaChart (main wrapper) ─────────────────────────────────────────────────

export interface AreaChartProps {
  data: Record<string, unknown>[];
  xAccessor?: (d: Record<string, unknown>) => Date;
  margin?: Margin;
  animationDuration?: number;
  children: ReactNode;
  className?: string;
}

export function AreaChart({
  data,
  xAccessor: xAccessorProp,
  margin = { top: 16, right: 16, bottom: 40, left: 56 },
  animationDuration = 800,
  children,
  className,
}: AreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const lines = useMemo((): LineConfig[] =>
    Children.toArray(children)
      .filter(isValidElement)
      .filter(c => (c.type as { displayName?: string }).displayName === "Area")
      .map(c => {
        const p = (c as ReactElement<AreaProps>).props;
        return {
          dataKey: p.dataKey,
          stroke: p.stroke ?? p.fill ?? chartCssVars.linePrimary,
          strokeWidth: p.strokeWidth ?? 2,
        };
      }),
  [children]);

  const xAccessor = useMemo(() =>
    xAccessorProp ?? ((d: Record<string, unknown>) => new Date(d.date as string)),
  [xAccessorProp]);

  const dateLabels = useMemo(() =>
    data.map(d => xAccessor(d).toLocaleDateString("pt-BR", { month: "short", day: "numeric" })),
  [data, xAccessor]);

  useEffect(() => {
    const t = setTimeout(() => setIsLoaded(true), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <ParentSize>
      {({ width, height }) => {
        if (width < 10 || height < 10) return null;
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const columnWidth = innerWidth / Math.max(data.length - 1, 1);

        const xScale = scaleTime<number>({
          range: [0, innerWidth],
          domain: [
            Math.min(...data.map(d => xAccessor(d).getTime())),
            Math.max(...data.map(d => xAccessor(d).getTime())),
          ],
        });

        const allValues = lines.flatMap(l =>
          data.map(d => (typeof d[l.dataKey] === "number" ? (d[l.dataKey] as number) : 0))
        );
        const yMax = Math.max(...allValues, 1);
        const yScale = scaleLinear<number>({
          range: [innerHeight, 0],
          domain: [0, yMax * 1.1],
          nice: true,
        });

        return (
          <_ChartInner
            animationDuration={animationDuration}
            className={className}
            columnWidth={columnWidth}
            containerRef={containerRef}
            data={data}
            dateLabels={dateLabels}
            height={height}
            innerHeight={innerHeight}
            innerWidth={innerWidth}
            isLoaded={isLoaded}
            lines={lines}
            margin={margin}
            setTooltipData={() => {}}
            tooltipData={null}
            width={width}
            xAccessor={xAccessor}
            xScale={xScale}
            yScale={yScale}
          >
            {children}
          </_ChartInner>
        );
      }}
    </ParentSize>
  );
}
AreaChart.displayName = "AreaChart";

function _ChartInner({
  children, data, xScale, yScale, width, height, innerWidth, innerHeight,
  margin, columnWidth, lines, isLoaded, animationDuration, xAccessor,
  dateLabels, containerRef, className,
}: ChartContextValue & { children: ReactNode; className?: string }) {
  const bisectDate = useMemo(() =>
    bisector<Record<string, unknown>, Date>(d => xAccessor(d)).left,
  [xAccessor]);

  const {
    tooltipData, setTooltipData, selection, clearSelection,
    interactionHandlers, interactionStyle,
  } = useChartInteraction({ xScale, yScale, data, lines, margin, xAccessor, bisectDate, canInteract: true });

  const ctx: ChartContextValue = {
    data, xScale, yScale, width, height, innerWidth, innerHeight, margin,
    columnWidth, tooltipData, setTooltipData, containerRef, lines,
    isLoaded, animationDuration, xAccessor, dateLabels, selection, clearSelection,
  };

  return (
    <ChartProvider value={ctx}>
      <div ref={containerRef as RefObject<HTMLDivElement>} className={cn("relative h-full w-full", className)}>
        <svg width={width} height={height}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {children}
            <rect
              width={innerWidth} height={innerHeight} fill="transparent"
              {...interactionHandlers} style={interactionStyle}
            />
          </g>
        </svg>
      </div>
    </ChartProvider>
  );
}
