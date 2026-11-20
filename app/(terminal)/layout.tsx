import { TopBar } from "../../components/Nav";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main
        id="main-content"
        className="mx-auto w-full max-w-[1240px] flex-1 px-4 pt-14 pb-[calc(52px+env(safe-area-inset-bottom)+2.5rem)] min-[600px]:px-6 md:pb-14 lg:px-8"
      >
        {children}
      </main>
    </div>
  );
}
