import { SideNav, TabBar } from "@/components/tab-bar";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <SideNav />
      <main className="pb-tabbar mx-auto w-full max-w-3xl px-4 sm:px-6 md:pb-12">
        {children}
      </main>
      <TabBar />
    </div>
  );
}
