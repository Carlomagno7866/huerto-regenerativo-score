import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Huerto Regenerativo SCORE",
  description: "Optimizador de cultivos agricolas para huertos plurianuales."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
