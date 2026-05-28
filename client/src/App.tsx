import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  preloadAdminPage,
  preloadBookingPage,
  preloadCancellationPage,
  preloadReschedulePage,
} from "@/lib/page-preloads";

const Home = lazy(() => import("@/pages/Home"));
const Booking = lazy(preloadBookingPage);
const Admin = lazy(preloadAdminPage);
const Cancellation = lazy(preloadCancellationPage);
const Reschedule = lazy(preloadReschedulePage);
const BarberInvite = lazy(() => import("@/pages/BarberInvite"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/">{() => <Home />}</Route>
        <Route path="/book">{() => <Booking />}</Route>
        <Route path="/admin">{() => <Admin />}</Route>
        <Route path="/cancel/:token">{() => <Cancellation />}</Route>
        <Route path="/reschedule/:token">{() => <Reschedule />}</Route>
        <Route path="/barber-invite/:token">{() => <BarberInvite />}</Route>
        <Route>{() => <NotFound />}</Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
