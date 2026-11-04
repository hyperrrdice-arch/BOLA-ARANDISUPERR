import { TopBar } from "../../components/Nav";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main id="main-content" className="mx-auto w-full max-w-[76rem] flex-1 px-6 py-14">
        {children}
      </main>
    </div>
  );
}
