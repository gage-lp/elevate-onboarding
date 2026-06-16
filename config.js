// ============================================================
// ELEVATE ONBOARDING — SHARED CONFIG & HELPERS
// Fill in the two values below from Supabase → Project Settings → API.
// The anon key is SAFE in client code — RLS does the protecting.
// ============================================================

const SUPABASE_URL = "https://qgvrdlokbgavsgqpvway.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFndnJkbG9rYmdhdnNncXB2d2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjAxNTEsImV4cCI6MjA5NzE5NjE1MX0.MreqXyB9eNeAsPuuKbs6nn1KHiLHBTfbqdc7GEUmg9k";

// Loaded from the CDN <script> in each HTML file
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- Auth guards ----------
async function getSessionUser() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user ?? null;
}

// Use at the top of any protected page. Redirects to login if signed out.
async function requireAuth() {
  const user = await getSessionUser();
  if (!user) {
    window.location.href = "index.html";
    return null;
  }
  const { data: profile } = await sb
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return { user, profile };
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = "index.html";
}

// ---------- Gating engine ----------
// Given modules (ordered) + this agent's progress rows, decide each module's
// state. A module is 'available' only if every BLOCKING module before it is
// complete. This is the 1-2-3 lock your boss wants.
function computeStatuses(modules, progressRows) {
  const byModule = {};
  progressRows.forEach(p => { byModule[p.module_id] = p; });

  let priorBlockingAllComplete = true;
  const sorted = [...modules].sort((a, b) => a.order_index - b.order_index);

  return sorted.map(m => {
    const existing = byModule[m.id];
    let status;

    if (existing && existing.status === "complete") {
      status = "complete";
    } else if (existing && existing.status === "submitted") {
      status = "submitted";           // done their part, waiting on a coach
    } else {
      status = priorBlockingAllComplete ? "available" : "locked";
    }

    // A blocking module that isn't fully complete locks everything after it.
    if (m.is_blocking && status !== "complete") {
      priorBlockingAllComplete = false;
    }

    return { ...m, _status: status, _progress: existing || null };
  });
}

// ---------- Write helpers ----------
// Create or fetch the progress row for (me, module).
async function ensureProgress(agentId, moduleId) {
  const { data, error } = await sb
    .from("progress")
    .upsert(
      { agent_id: agentId, module_id: moduleId, status: "available" },
      { onConflict: "agent_id,module_id", ignoreDuplicates: false }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Save a submission artifact (link, file path, booking note, text).
async function saveSubmission(progressId, type, payload) {
  const { error } = await sb
    .from("submissions")
    .insert({ progress_id: progressId, type, payload });
  if (error) throw error;
}

// Move a progress row to complete (self) or submitted (waiting on admin).
async function setProgressStatus(progressId, status, completedBy = null) {
  const patch = { status };
  if (status === "complete") {
    patch.completed_at = new Date().toISOString();
    patch.completed_by = completedBy;
  }
  const { error } = await sb.from("progress").update(patch).eq("id", progressId);
  if (error) throw error;
}
