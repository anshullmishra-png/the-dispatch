import type { Metadata } from "next";
import { Bitter, Playfair_Display, PT_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime request to Google).
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-playfair" });
const bitter = Bitter({ subsets: ["latin"], weight: ["300", "400", "700"], variable: "--font-bitter" });
const ptSans = PT_Sans({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-ptsans" });

export const metadata: Metadata = {
  title: "The Dispatch · Editor's desk",
  description: "Shreya's editorial desk: the week's articles collected and de-duplicated, Gemini's picks and commentary, her review and the Thursday send.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${playfair.variable} ${bitter.variable} ${ptSans.variable}`}>
      <body>
        <div className="frame">
          <header className="nav">
            <div className="nav-left">
              <Link href="/desk" className="nav-badge" aria-label="Desk">
                ◆
              </Link>
              <nav className="nav-links" aria-label="Main">
                <Link href="/desk">Desk</Link>
                <Link href="/issues">Archive</Link>
                <Link href="/articles">Articles</Link>
                <Link href="/status">Settings &amp; status</Link>
              </nav>
            </div>
            <Link href="/desk" className="wordmark">
              THE DISPATCH
            </Link>
            <div className="nav-right">
              <a href="/preview" className="button" target="_blank" rel="noopener">
                Preview email
              </a>
            </div>
          </header>
          <main>{children}</main>
          <footer className="footer">
            <div>
              <h2>Desk</h2>
              <ul>
                <li>
                  <Link href="/desk">This week&rsquo;s issue</Link>
                </li>
                <li>
                  <Link href="/issues">Archive</Link>
                </li>
                <li>
                  <Link href="/articles">Articles</Link>
                </li>
              </ul>
            </div>
            <div>
              <h2>Behind the desk</h2>
              <ul>
                <li>
                  <Link href="/status">Settings &amp; status</Link>
                </li>
                <li>
                  <Link href="/style-guide">Editorial voice</Link>
                </li>
                <li>
                  <a href="https://github.com/anshullmishra-png/the-dispatch">Source on GitHub</a>
                </li>
              </ul>
            </div>
            <div>
              <h2>About</h2>
              <p>
                Shreya&rsquo;s editorial desk for The Dispatch. The pipeline reads the week&rsquo;s news and drafts; she decides what goes out. Review
                works here and on Telegram, on the same issue.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
