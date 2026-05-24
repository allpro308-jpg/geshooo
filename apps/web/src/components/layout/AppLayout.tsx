import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";

type AppLayoutProps = {
  children: ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-20 border-b border-hairline bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="focus-ring rounded-md outline-none">
            <Logo />
          </Link>
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">{children}</main>
    </div>
  );
}
