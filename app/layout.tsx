import type { Metadata } from "next";
import { Bitter, Playfair_Display, PT_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime request to Google).
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-playfair" });
const bitter = Bitter({ subsets: ["latin"], weight: ["300", "400", "700"], variable: "--font-bitter" });
const ptSans = PT_Sans({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-ptsans" });

export const metadata: Metadata = {
  title: "The Dispatch",
  description: "A weekly read on India's startup ecosystem: eight to ten stories, picked by AI, reviewed by an editor.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${playfair.variable} ${bitter.variable} ${ptSans.variable}`}>
      <body>
        <div className="frame">
          <header className="nav">
            <div className="nav-left">
              <Link href="/" className="nav-badge" aria-label="Home">
                ◆
              </Link>
              <nav className="nav-links" aria-label="Main">
                <Link href="/desk">Desk</Link>
                <Link href="/issues">Archive</Link>
                <Link href="/articles">Articles</Link>
                <Link href="/status">Status</Link>
              </nav>
            </div>
            <Link href="/" className="wordmark">
              THE DISPATCH
            </Link>
            <div className="nav-right">
              <Link href="/#subscribe" className="button">
                Subscribe
              </Link>
            </div>
          </header>
          <main>{children}</main>
          <footer className="footer">
            <div>
              <h2>Pages</h2>
              <ul>
                <li>
                  <Link href="/">Home</Link>
                </li>
                <li>
                  <Link href="/issues">Archive</Link>
                </li>
                <li>
                  <Link href="/desk">Editor&rsquo;s desk</Link>
                </li>
                <li>
                  <Link href="/status">System status</Link>
                </li>
                <li>
                  <Link href="/articles">Articles</Link>
                </li>
                <li>
                  <Link href="/style-guide">Style guide</Link>
                </li>
              </ul>
            </div>
            <div>
              <h2>Elsewhere</h2>
              <ul>
                <li>
                  <a href="https://github.com/anshullmishra-png/the-dispatch">Source on GitHub</a>
                </li>
                <li>
                  <a href="/api/health">System health</a>
                </li>
              </ul>
            </div>
            <div>
              <h2>About</h2>
              <p>
                Every Thursday morning. Stories are collected and drafted by AI, then kept, edited or swapped by Shreya, our editor, before
                anything is sent.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
