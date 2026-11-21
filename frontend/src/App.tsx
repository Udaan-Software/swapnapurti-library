import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./app/AuthProvider";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MembersPage } from "./pages/MembersPage";
import { MemberProfilePage } from "./pages/MemberProfilePage";
import { ResourcePage, badge } from "./pages/ResourcePage";
import { BackupPage, ReportsPage, SettingsPage } from "./pages/SystemPage";
import { AttendancePage, BooksPage, ExpensesPage, FinesPage, LoansPage, NotificationsPage, PaymentsPage, PlansPage, ReservationsPage, RoomsSeatsPage, ShiftsPage, SubscriptionsPage } from "./pages/ManagementPages";

export default function App(){
  const{admin,loading}=useAuth();
  if(loading)return <div className="grid min-h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent"/><p className="mt-4 text-sm text-slate-300">Opening Swapnapurti Library…</p></div></div>;
  if(!admin)return <AuthPage/>;
  return <AppShell><Routes>
    <Route path="/" element={<DashboardPage/>}/>
    <Route path="/members" element={<MembersPage/>}/>
    <Route path="/members/:id" element={<MemberProfilePage/>}/>
    <Route path="/plans" element={<PlansPage/>}/>
    <Route path="/subscriptions" element={<SubscriptionsPage/>}/>
    <Route path="/seats" element={<RoomsSeatsPage/>}/>
    <Route path="/shifts" element={<ShiftsPage/>}/>
    <Route path="/attendance" element={<AttendancePage/>}/>
    <Route path="/books" element={<BooksPage/>}/>
    <Route path="/loans" element={<LoansPage/>}/>
    <Route path="/reservations" element={<ReservationsPage/>}/>
    <Route path="/fines" element={<FinesPage/>}/>
    <Route path="/payments" element={<PaymentsPage/>}/>
    <Route path="/expenses" element={<ExpensesPage/>}/>
    <Route path="/notifications" element={<NotificationsPage/>}/>
    <Route path="/reports" element={<ReportsPage/>}/>
    <Route path="/settings" element={<SettingsPage/>}/>
    <Route path="/audit" element={<ResourcePage title="Audit Logs" description="Append-only history of sensitive administrator actions." endpoint="/audit-logs" columns={[{label:"Time",value:r=>new Date(r.createdAt).toLocaleString("en-IN")},{label:"Action",value:r=>badge(r.action)},{label:"Entity",value:r=>r.entityType},{label:"Administrator",value:r=>r.admin?.name||"System"}]}/>}/>
    <Route path="/backup" element={<BackupPage/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></AppShell>
}
