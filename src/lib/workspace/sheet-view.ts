/** Serializable geometry shared by the authenticated reader and browser viewer. */
export type ViewStyle = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "italic";
  color?: string;
  backgroundColor?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  verticalAlign?: "top" | "middle" | "bottom";
  whiteSpace?: "pre" | "pre-wrap";
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  textDecoration?: string;
};
export type ViewCell = {
  address: string;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  style: ViewStyle;
  formula: boolean;
  runs?: { text: string; style: ViewStyle }[];
};
export type SheetView = {
  sheet: string;
  width: number;
  height: number;
  columns: { label: string; x: number; width: number }[];
  rows: { number: number; y: number; height: number }[];
  cells: ViewCell[];
  images: {
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  focus: { x: number; y: number; width: number; height: number };
  warnings: string[];
};
export function columnName(n: number): string {
  let result = "";
  for (; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
