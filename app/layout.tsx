import "@/app/globals.css";
import "@/styles/app-shell.css";
import Providers from "@/components/Providers";

export const metadata = {
  title: "test",
  description: "PWA-like app shell with responsive navigation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
