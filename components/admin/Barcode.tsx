import { code128 } from "@/lib/barcode";

/** Renders a Code128 barcode for `value` as inline SVG (print-safe, no dependencies). */
export function Barcode({ value, height = 44, unit = 1.5 }: { value: string; height?: number; unit?: number }) {
  const { widths, modules } = code128(value);
  const w = modules * unit;
  const rects: JSX.Element[] = [];
  let x = 0;
  widths.forEach((width, i) => {
    if (i % 2 === 0) rects.push(<rect key={i} x={x} y={0} width={width * unit} height={height} fill="#000" />);
    x += width * unit;
  });
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="xMidYMid meet" shapeRendering="crispEdges">
      {rects}
    </svg>
  );
}
