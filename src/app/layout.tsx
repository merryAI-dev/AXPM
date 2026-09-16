import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AXPM · 멘토링 운영 에이전트",
  description: "기존 시트 위에서 일하는 멘토링 운영 에이전트",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
