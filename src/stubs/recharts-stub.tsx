/**
 * Stub for `recharts`.
 *
 * @once-ui-system/core lazy-loads its chart implementation files via
 *   `React.lazy(() => import("./LineChart.impl").catch(...))`
 *
 * Even though that import is dynamic, Rollup still creates a chunk for the
 * impl file at build time. Those impl files do top-level
 *   `import { AreaChart, ResponsiveContainer, ... } from "recharts"`
 * which means recharts has to resolve to *something* with those named exports
 * or the chunk fails to build.
 *
 * Nyrima never renders any Once UI chart component, so the entire
 * lazy chunk is dead code at runtime. The stubs below exist purely to satisfy
 * Rollup's static analysis; they return null and will never execute.
 */

import type { ReactNode } from "react";

const Noop = (_props: { children?: ReactNode; [k: string]: unknown }) => null;
Noop.displayName = "RechartsStub";

export const AreaChart = Noop;
export const Area = Noop;
export const BarChart = Noop;
export const Bar = Noop;
export const LineChart = Noop;
export const Line = Noop;
export const PieChart = Noop;
export const Pie = Noop;
export const Cell = Noop;
export const ComposedChart = Noop;
export const Scatter = Noop;
export const ScatterChart = Noop;
export const RadarChart = Noop;
export const Radar = Noop;
export const Treemap = Noop;
export const Sankey = Noop;
export const Funnel = Noop;
export const FunnelChart = Noop;
export const XAxis = Noop;
export const YAxis = Noop;
export const ZAxis = Noop;
export const CartesianGrid = Noop;
export const PolarGrid = Noop;
export const PolarAngleAxis = Noop;
export const PolarRadiusAxis = Noop;
export const Tooltip = Noop;
export const Legend = Noop;
export const Brush = Noop;
export const ReferenceLine = Noop;
export const ReferenceArea = Noop;
export const ReferenceDot = Noop;
export const Label = Noop;
export const LabelList = Noop;
export const ResponsiveContainer = Noop;
export const Customized = Noop;
export const ErrorBar = Noop;
export const Surface = Noop;
export const Symbols = Noop;
export const Trapezoid = Noop;
export const Sector = Noop;
export const Rectangle = Noop;
export const Polygon = Noop;
export const Dot = Noop;
export const Text = Noop;
export const Layer = Noop;
export const Cross = Noop;
export const Curve = Noop;

export default Noop;
