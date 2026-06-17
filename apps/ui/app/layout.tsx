import type { Metadata } from 'next';
import { Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { Nav } from '@/components/nav';

const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Bottlenose',
  description: 'Bottlenose — machine config and project management',
};

const themeScript = `try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.remove('dark')}else{document.documentElement.classList.add('dark')}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${mono.variable} font-mono bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-zinc-100 min-h-screen`}>
        <Nav />
        <main className="px-6 py-8 max-w-4xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
