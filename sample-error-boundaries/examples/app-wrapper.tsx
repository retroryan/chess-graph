/**
 * Before/After Example — _app.tsx top-level boundary
 *
 * The _app.tsx file is the root of the component tree in the Pages Router.
 * Adding a boundary here acts as a last-resort catch — if an error escapes
 * a section-level boundary (or occurs in a page that hasn't been wrapped yet),
 * the user sees a full-page error screen with a reload button instead of a
 * blank white screen.
 *
 * This is NOT a replacement for section-level boundaries. It's the outermost
 * safety net. Section-level boundaries (analysis, coach, puzzles) should catch
 * most errors and keep the rest of the page functional. The app-level boundary
 * only fires when something unexpected escapes all inner boundaries.
 */

// ===========================================================================
// BEFORE — current _app.tsx (no error boundary)
// ===========================================================================
//
// export default function MyApp({ Component, pageProps }: AppProps) {
//   const isMaintenanceMode = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === "true";
//   if (isMaintenanceMode) return <MaintenancePage />;
//
//   return (
//     <>
//       <Head>...</Head>
//       <QueryClientProvider client={queryClient}>
//         <AuthProvider>
//           <Layout>
//             {/* Any error here → blank white screen */}
//             <Component {...pageProps} />
//           </Layout>
//         </AuthProvider>
//       </QueryClientProvider>
//     </>
//   );
// }

// ===========================================================================
// AFTER — with top-level error boundary
// ===========================================================================

import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { AppProps } from "next/app";
import Layout from "@/sections/layout";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";
import { Typography, Box, Container, Button } from "@mui/material";
import Head from "next/head";

import { ErrorBoundary } from "../ErrorBoundary";

const queryClient = new QueryClient();

/**
 * Full-page error fallback — shown only when an error escapes all inner
 * boundaries. Provides a simple "Reload" button since the entire app is
 * in an unrecoverable state at this point.
 */
function AppErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Container maxWidth="sm" sx={{ textAlign: "center", mt: 8 }}>
      <Box sx={{ p: 4 }}>
        <img
          src="/android-chrome-192x192.png"
          width={96}
          height={96}
          alt="Chess Masti AI"
          style={{ marginBottom: "24px" }}
        />
        <Typography variant="h4" gutterBottom color="primary">
          Something went wrong
        </Typography>
        <Typography variant="body1" sx={{ mt: 2, mb: 1, color: "text.secondary" }}>
          An unexpected error occurred. This has been reported automatically.
        </Typography>
        <Typography
          variant="body2"
          sx={{
            mt: 1,
            mb: 3,
            fontFamily: "monospace",
            color: "text.disabled",
            wordBreak: "break-word",
          }}
        >
          {error.message}
        </Typography>
        <Box sx={{ display: "flex", gap: 2, justifyContent: "center" }}>
          <Button
            variant="contained"
            onClick={reset}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            Try Again
          </Button>
          <Button
            variant="outlined"
            onClick={() => window.location.reload()}
            sx={{ textTransform: "none" }}
          >
            Reload Page
          </Button>
        </Box>
      </Box>
    </Container>
  );
}

export default function MyApp({ Component, pageProps }: AppProps) {
  const isMaintenanceMode = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === "true";
  if (isMaintenanceMode) {
    return <MaintenancePage />;
  }

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <title>Chess Masti AI - Make Chess Fun with AI-Powered Coaching!</title>
      </Head>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* ----------------------------------------------------------------
              APP-LEVEL BOUNDARY: Last-resort safety net.
              Wraps Layout + Page. If an error escapes all section-level
              boundaries, the user sees AppErrorFallback instead of a blank
              white screen. The "Try Again" button calls reset() which
              re-renders the tree. "Reload Page" does a full browser reload.

              Note: This boundary is INSIDE QueryClientProvider and
              AuthProvider so that those contexts survive the reset. The
              user stays authenticated after clicking "Try Again".
              ---------------------------------------------------------------- */}
          <ErrorBoundary
            name="app"
            fallback={(props) => <AppErrorFallback {...props} />}
          >
            <Layout>
              <Component {...pageProps} />
            </Layout>
          </ErrorBoundary>
        </AuthProvider>
      </QueryClientProvider>
    </>
  );
}

// (MaintenancePage omitted for brevity — unchanged from current code)
function MaintenancePage() {
  return (
    <Container maxWidth="sm" sx={{ textAlign: "center", mt: 8 }}>
      <Typography variant="h5">Under Maintenance</Typography>
    </Container>
  );
}

// ===========================================================================
// Boundary placement hierarchy
// ===========================================================================
//
//   _app.tsx
//     ErrorBoundary name="app"            ← last resort (this file)
//       Layout
//         analysis.tsx
//           ErrorBoundary name="chessboard"    ← section level
//           ErrorBoundary name="analysis"      ← section level
//           ErrorBoundary name="moves-coach"   ← section level
//           ErrorBoundary name="ai-coach"      ← section level
//         practice.tsx
//           ErrorBoundary name="puzzle-rush"   ← section level
//           ErrorBoundary name="pattern-training"
//           ErrorBoundary name="practice-board"
//
// An error in AICoachChat:
//   1. Caught by "ai-coach" boundary → coach tab shows error, board works
//   2. If "ai-coach" boundary somehow fails → "app" boundary catches it
//   3. User never sees a blank white screen
