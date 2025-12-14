import { useEffect, useMemo, useRef, useState } from "react";
import { SEOHead } from "@/components/SEOHead";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  ArrowLeft,
  Download,
  Pause,
  Play,
  Shield,
  Square,
  Target,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";

type ControlRoomState = "idle" | "running" | "paused" | "halted";

type Artifact = {
  id: string;
  program: string;
  level: number;
  timestamp: number;
  contextTag: string;
  target: string;
  token: string;
  scope: string;
  persistence: boolean;
  selectedCrawler: boolean;
  signals: {
    confidence: number;
    resource: number;
    latency: number;
    resistance: number;
  };
  notes: string;
};

const POWER_LEVELS: Array<{ level: number; label: string }> = [
  { level: 1, label: "Inspection" },
  { level: 2, label: "Soft Push" },
  { level: 3, label: "Hard Push" },
  { level: 4, label: "Boundary Testing" },
  { level: 5, label: "Deep Interaction" },
  { level: 6, label: "Full Control" },
];

const PROGRAMS: Array<{ id: string; name: string; scope: string }> = [
  {
    id: "cryptocrawler-control-room",
    name: "CryptoCrawler Control Room (Bug Bounty Mode)",
    scope:
      "Scope is informational only.\n- Target-defined surface mapping\n- Evidence capture + export bundles\n- No auto-halt, no validation police\n\n(Configure real program scope rules here.)",
  },
  {
    id: "general-recon",
    name: "General Recon / Ops",
    scope:
      "Scope is informational only.\n- Signal-first recon\n- Artifact-first evidence capture\n\n(Configure real program scope rules here.)",
  },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export default function ControlRoomPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Header / operation
  const [programId, setProgramId] = useState(PROGRAMS[0].id);
  const program = useMemo(
    () => PROGRAMS.find((p) => p.id === programId) ?? PROGRAMS[0],
    [programId]
  );

  const [state, setState] = useState<ControlRoomState>("idle");
  const [masterStopVisible, setMasterStopVisible] = useState(false); // visible, not enforced

  // Target / context
  const [target, setTarget] = useState("");
  const [token, setToken] = useState("");
  const [contextTag, setContextTag] = useState("");

  // Optional safety rails (optional, user-controlled)
  const [killSwitchArmed, setKillSwitchArmed] = useState(false);
  const [persistence, setPersistence] = useState(false);

  // Gadgets
  const [selectedCrawler, setSelectedCrawler] = useState(false);

  // Power dial
  const [adminCap, setAdminCap] = useState(6);
  const [level, setLevel] = useState(1);

  // Signal monitor (abstracted)
  const [confidence, setConfidence] = useState(0.35);
  const [resource, setResource] = useState(0.2);
  const [latency, setLatency] = useState(0.15);
  const [resistance, setResistance] = useState(0.1);

  // Artifacts
  const [notes, setNotes] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const lastSignalRef = useRef({
    confidence,
    resource,
    latency,
    resistance,
  });

  useEffect(() => {
    lastSignalRef.current = { confidence, resource, latency, resistance };
  }, [confidence, latency, resistance, resource]);

  // Simulated live signals for the control surface (abstracted)
  useEffect(() => {
    if (state !== "running") return;
    const id = window.setInterval(() => {
      // deterministic-ish noise from time; stays "abstracted"
      const t = Date.now();
      const wobble = (x: number) => (Math.sin(t / x) + 1) / 2;

      const base = clamp(0.25 + 0.55 * wobble(900), 0, 1);
      const lvl = level / 6;

      setConfidence(clamp(base * (0.65 + 0.35 * lvl), 0, 1));
      setResource(clamp(0.15 + 0.7 * wobble(650) * (0.3 + 0.7 * lvl), 0, 1));
      setLatency(clamp(0.08 + 0.6 * wobble(1100) * (0.25 + 0.75 * lvl), 0, 1));
      setResistance(clamp(0.05 + 0.75 * wobble(1400) * (0.2 + 0.8 * lvl), 0, 1));
    }, 650);

    return () => window.clearInterval(id);
  }, [level, state]);

  // Kill switch semantics: instant UI halt
  useEffect(() => {
    if (!killSwitchArmed) return;
    setState("halted");
    toast({
      title: "Kill switch engaged",
      description: "Execution state forced to HALTED (UI-level).",
    });
  }, [killSwitchArmed, toast]);

  const scopeText = program.scope;
  const statusBadge = (() => {
    if (state === "running") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    if (state === "paused") return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    if (state === "halted") return "bg-red-500/20 text-red-300 border-red-500/30";
    return "bg-slate-500/20 text-slate-300 border-slate-500/30";
  })();

  const statusLabel = state.toUpperCase();

  const resolvedAdminCap = clamp(adminCap, 1, 6);
  const resolvedLevel = clamp(level, 1, resolvedAdminCap);
  useEffect(() => {
    if (level !== resolvedLevel) setLevel(resolvedLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedLevel]);

  const levelLabel = POWER_LEVELS.find((p) => p.level === resolvedLevel)?.label ?? "—";

  const captureArtifact = () => {
    const now = Date.now();
    const a: Artifact = {
      id: `${now}-${Math.random().toString(16).slice(2)}`,
      program: program.name,
      level: resolvedLevel,
      timestamp: now,
      contextTag: contextTag || "untagged",
      target,
      token,
      scope: scopeText,
      persistence,
      selectedCrawler,
      signals: { ...lastSignalRef.current },
      notes,
    };
    setArtifacts((prev) => [a, ...prev]);
    toast({
      title: "Snapshot captured",
      description: `Stamped: ${program.name} • L${resolvedLevel} • ${new Date(now).toLocaleString()}`,
    });
  };

  const exportArtifacts = () => {
    const now = Date.now();
    const bundle = {
      exportedAt: now,
      program: program.name,
      level: resolvedLevel,
      contextTag: contextTag || "untagged",
      target,
      persistence,
      artifacts,
    };
    downloadJson(`control-room-artifacts-${now}.json`, bundle);
    toast({
      title: "Exported",
      description: `Bundle includes ${artifacts.length} artifact(s).`,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900/30 to-slate-950">
      <SEOHead
        title="Control Room | Bug / Recon / Ops"
        description="Sovereign control surface: target, dial, signals, artifacts."
        noIndex={true}
      />

      {/* Header */}
      <header className="border-b border-slate-700/40 bg-black/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/welcome")}
                className="text-slate-300 hover:text-white hover:bg-white/10"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <div className="p-2 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 border border-white/10">
                <Shield className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Control Room</h1>
                <p className="text-sm text-slate-300">Bug / Recon / Ops • Separate surface</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge className={statusBadge}>
                <Activity className="w-3 h-3 mr-1" />
                {statusLabel}
              </Badge>

              <Badge className={persistence ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" : "bg-slate-500/20 text-slate-300 border-slate-500/30"}>
                {persistence ? "PERSISTENCE" : "NO-PERSISTENCE"}
              </Badge>

              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                <span className="text-xs text-slate-300">Master stop (visible)</span>
                <Switch checked={masterStopVisible} onCheckedChange={setMasterStopVisible} />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Program / Operation selector */}
        <Card className="bg-slate-900/40 border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Program / Operation</CardTitle>
            <CardDescription className="text-slate-400">
              Interactive by default. Behavior is controlled by your intent — not enforced semantics.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Program selector</Label>
              <Select value={programId} onValueChange={setProgramId}>
                <SelectTrigger className="bg-black/30 border-white/10 text-white">
                  <SelectValue placeholder="Select program" />
                </SelectTrigger>
                <SelectContent>
                  {PROGRAMS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Context tag</Label>
              <Input
                value={contextTag}
                onChange={(e) => setContextTag(e.target.value)}
                placeholder="e.g. bounty-2025-12"
                className="bg-black/30 border-white/10 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Optional safety rails</Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox checked={selectedCrawler} onCheckedChange={(v) => setSelectedCrawler(Boolean(v))} />
                  <span className="text-sm text-slate-300">CryptoCrawler selection</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={persistence} onCheckedChange={(v) => setPersistence(Boolean(v))} />
                  <span className="text-sm text-slate-300">Incorporate persistence</span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setKillSwitchArmed(true)}
                  className="h-9"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Kill Switch
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Target / Context */}
        <Card className="bg-slate-900/40 border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Target / Context</CardTitle>
            <CardDescription className="text-slate-400">
              No auto-halt. No validation police. If you enter junk, the system runs junk.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2 lg:col-span-2">
              <Label className="text-slate-300">Target (freeform)</Label>
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Target URL / asset / endpoint / identifier..."
                className="bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Token / credential (freeform)</Label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token / key / session..."
                className="bg-black/30 border-white/10 text-white font-mono"
              />
            </div>

            <div className="space-y-2 lg:col-span-3">
              <Label className="text-slate-300">Scope viewer (informational)</Label>
              <Textarea
                value={scopeText}
                readOnly
                className="bg-black/30 border-white/10 text-slate-200 min-h-[140px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* Six-Level Power Dial + Controls */}
        <Card className="bg-slate-900/40 border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Six-Level Power Dial</CardTitle>
            <CardDescription className="text-slate-400">
              Levels are descriptive posture states — labels only. Admin can cap max level.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-3 lg:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-white/70" />
                  <span className="text-sm text-slate-200">Level</span>
                  <Badge className="bg-white/10 text-slate-200 border-white/10">{resolvedLevel} / {resolvedAdminCap}</Badge>
                </div>
                <span className="text-sm text-slate-300">{levelLabel}</span>
              </div>

              <Slider
                value={[resolvedLevel]}
                min={1}
                max={resolvedAdminCap}
                step={1}
                onValueChange={([v]) => setLevel(v)}
              />

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {POWER_LEVELS.map((p) => (
                  <div
                    key={p.level}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      p.level === resolvedLevel
                        ? "border-white/30 bg-white/10 text-white"
                        : p.level <= resolvedAdminCap
                          ? "border-white/10 bg-black/20 text-slate-300"
                          : "border-white/5 bg-black/10 text-slate-500"
                    }`}
                  >
                    <div className="font-medium">L{p.level}</div>
                    <div className="text-xs">{p.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-slate-300">Admin cap (max level)</Label>
              <Select value={String(resolvedAdminCap)} onValueChange={(v) => setAdminCap(parseInt(v, 10))}>
                <SelectTrigger className="bg-black/30 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button
                  onClick={() => setState("running")}
                  disabled={state === "running"}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Run
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setState("paused")}
                  disabled={state !== "running"}
                  className="border-white/10 text-slate-200 bg-black/20 hover:bg-white/10"
                >
                  <Pause className="w-4 h-4 mr-2" />
                  Pause
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setState("halted")}
                  className="col-span-2"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Halt
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Signal / Feedback */}
        <Card className="bg-slate-900/40 border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Signal / Feedback</CardTitle>
            <CardDescription className="text-slate-400">Abstract indicators • confidence bands • resource • latency • resistance</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-cyan-300" />
                  Confidence band
                </span>
                <span className="text-sm text-slate-200">{Math.round(confidence * 100)}%</span>
              </div>
              <Progress value={confidence * 100} className="h-3" />

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Resource usage</span>
                <span className="text-sm text-slate-200">{Math.round(resource * 100)}%</span>
              </div>
              <Progress value={resource * 100} className="h-3" />

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Latency</span>
                <span className="text-sm text-slate-200">{Math.round(latency * 100)}%</span>
              </div>
              <Progress value={latency * 100} className="h-3" />

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Resistance</span>
                <span className="text-sm text-slate-200">{Math.round(resistance * 100)}%</span>
              </div>
              <Progress value={resistance * 100} className="h-3" />
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-slate-400 mb-1">Status lights</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={state === "idle" ? "bg-slate-500/20 text-slate-200" : "bg-black/20 text-slate-500 border border-white/5"}>Idle</Badge>
                    <Badge className={state === "running" ? "bg-emerald-500/20 text-emerald-200" : "bg-black/20 text-slate-500 border border-white/5"}>Running</Badge>
                    <Badge className={state === "halted" ? "bg-red-500/20 text-red-200" : "bg-black/20 text-slate-500 border border-white/5"}>Halted</Badge>
                    <Badge className={persistence ? "bg-cyan-500/20 text-cyan-200" : "bg-black/20 text-slate-500 border border-white/5"}>Persistence</Badge>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-slate-400 mb-1">Execution posture</div>
                  <div className="text-sm text-slate-200">
                    {program.name}
                    <div className="text-xs text-slate-400 mt-1">Dial: L{resolvedLevel} ({levelLabel})</div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-slate-400 mb-2">Notes (for evidence + export)</div>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observations, hypotheses, key timestamps, reproduction notes..."
                  className="bg-black/30 border-white/10 text-white min-h-[120px]"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Artifact / Output Tray */}
        <Card className="bg-slate-900/40 border-white/10">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-white">Artifact / Output Tray</CardTitle>
                <CardDescription className="text-slate-400">
                  Captures are auto-stamped: program • dial level • timestamp • context tag. Export is one tap.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={captureArtifact} className="border-white/10 bg-black/20 text-slate-200 hover:bg-white/10">
                  <Target className="w-4 h-4 mr-2" />
                  Capture snapshot
                </Button>
                <Button onClick={exportArtifacts} disabled={artifacts.length === 0} className="bg-cyan-600 hover:bg-cyan-700">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {artifacts.length === 0 ? (
              <div className="text-slate-400 text-sm">
                No artifacts yet. Capture a snapshot to build an evidence bundle.
              </div>
            ) : (
              <div className="space-y-2">
                {artifacts.slice(0, 12).map((a) => (
                  <div key={a.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-white/10 text-slate-200 border-white/10">{a.program}</Badge>
                        <Badge className="bg-white/10 text-slate-200 border-white/10">L{a.level}</Badge>
                        <Badge className="bg-white/10 text-slate-200 border-white/10">{a.contextTag}</Badge>
                      </div>
                      <div className="text-xs text-slate-400">{new Date(a.timestamp).toLocaleString()}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <div className="text-slate-300">
                        <span className="text-slate-500">Target:</span> {a.target || "—"}
                      </div>
                      <div className="text-slate-300">
                        <span className="text-slate-500">Signals:</span>{" "}
                        C{Math.round(a.signals.confidence * 100)} / R{Math.round(a.signals.resource * 100)} / L{Math.round(a.signals.latency * 100)} / X{Math.round(a.signals.resistance * 100)}
                      </div>
                    </div>
                  </div>
                ))}
                {artifacts.length > 12 && (
                  <div className="text-xs text-slate-500">Showing latest 12 of {artifacts.length} artifacts (export includes all).</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

