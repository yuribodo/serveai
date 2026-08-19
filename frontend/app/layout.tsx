import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "FIELD — Serviços locais, resolvidos",
  description: "Um agente autônomo para contratar serviços locais por você.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={GeistSans.className}>{children}</body>
    </html>
  );
}
