import { TopBar } from "../../components/Nav";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main
        id="main-content"
        className="shell-x mx-auto w-full max-w-[1200px] flex-1 pt-14 pb-[calc(52px+env(safe-area-inset-bottom)+2.5rem)] md:pb-14"
      >
        {children}
      </main>
    </div>
  );
}
