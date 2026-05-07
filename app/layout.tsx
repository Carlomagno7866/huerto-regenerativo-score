import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Huerto Regenerativo SCORE",
  description: "Optimizador de cultivos agricolas para huertos plurianuales."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <nav className="site-nav" aria-label="Navegacion principal">
          <Link href="/">Planificador</Link>
          <Link href="/score">SCORE</Link>
          <Link href="/trueque">Trueque</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
