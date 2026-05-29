import { Outlet } from "react-router-dom";
import { AppSidebar } from "./app-sidebar";

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto bg-white">
        <Outlet />
      </main>
    </div>
  );
}
