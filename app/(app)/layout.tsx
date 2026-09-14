import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { CommandPalette } from "@/components/layout/command-palette";
import { AiCopilotDrawer } from "@/components/crm/AiCopilotDrawer";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  
  if (!user) {
    redirect("/sign-in");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-text-primary antialiased font-sans">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header userFirstName={user?.firstName} />
        <main className="flex-1 overflow-y-auto p-6 md:p-8 lg:p-10 scrollbar-thin">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette />
      <AiCopilotDrawer />
    </div>
  );
}
