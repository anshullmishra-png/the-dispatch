import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Dispatch",
  description: "A weekly read on India's startup ecosystem.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
