import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TenFront → Kommo Sync',
  description: 'Dashboard de sincronização de vendas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-gray-950 text-gray-100 min-h-screen">{children}</body>
    </html>
  );
}
