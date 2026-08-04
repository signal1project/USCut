import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Sparkles, Film, ShieldCheck } from 'lucide-react';
import { PLATFORMS, type Platform } from '@mas/types';
import type {
  AgentAdaptersResponse,
  CampaignPackageSummary,
  WorkflowCampaignPackageResult,
} from '@mas/ui';
import { useMasApi } from './useMasApi';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Label,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/utils';

const DEFAULT_PLATFORMS: Platform[] = ['instagram', 'youtube'];

export default function OmobonoPage(): React.ReactElement {
  const api = useMasApi();
  const [adapters, setAdapters] = useState<AgentAdaptersResponse | null>(null);
  const [campaignTitle, setCampaignTitle] = useState(
    'Family Office Web Design Lead Sprint',
  );
  const [objective, setObjective] = useState(
    'Generate qualified website redesign leads for The Family Office while riding current small-business marketing trends.',
  );
  const [niche, setNiche] = useState('web design');
  const [tone, setTone] = useState('educational');
  const [platforms, setPlatforms] = useState<Platform[]>(DEFAULT_PLATFORMS);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WorkflowCampaignPackageResult | null>(
    null,
  );
  const [packages, setPackages] = useState<CampaignPackageSummary[]>([]);

  useEffect(() => {
    if (!api) return;
    api
      .listAgentAdapters()
      .then(setAdapters)
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : 'Could not load agent adapters',
        ),
      );
    api
      .listCampaignPackages({ limit: 10 })
      .then((response) => setPackages(response.packages))
      .catch(() => undefined);
  }, [api]);

  const togglePlatform = (platform: Platform) => {
    setPlatforms((prev) => {
      if (prev.includes(platform)) return prev.filter((p) => p !== platform);
      return [...prev, platform];
    });
  };

  const createPackage = async () => {
    if (!api || platforms.length === 0) return;
    setLoading(true);
    try {
      const next = await api.createCampaignPackage({
        campaignTitle,
        objective,
        niche,
        platforms,
        tone,
        approvalMode: 'dale_required',
      });
      setResult(next);
      if (next.persistedPackage) {
        setPackages((prev) => [
          next.persistedPackage!,
          ...prev.filter((pkg) => pkg.id !== next.persistedPackage!.id),
        ]);
      }
      toast.success('Omobono campaign package created');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Campaign package failed',
      );
    } finally {
      setLoading(false);
    }
  };

  const approvePackage = async (id: string) => {
    if (!api) return;
    try {
      const updated = await api.updateCampaignPackageStatus(id, 'approved');
      setPackages((prev) => prev.map((pkg) => (pkg.id === id ? updated : pkg)));
      toast.success('Campaign package approved for scheduling');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const markPublished = async (pkg: CampaignPackageSummary) => {
    if (!api) return;
    try {
      const updated = await api.recordPublicationFeedback(pkg.id, {
        platform: pkg.platforms[0],
        externalPostId: `manual-${Date.now()}`,
        publishedAt: new Date().toISOString(),
        notes:
          'Marked published from Omobono approval queue; analytics capture pending.',
      });
      setPackages((prev) =>
        prev.map((item) => (item.id === pkg.id ? updated : item)),
      );
      toast.success(
        'Published marker saved; analytics feedback is pending capture',
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not mark package published',
      );
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-strong">
          <Bot size={18} className="text-accent" />
          Omobono Social Engine
        </h2>
        <p className="text-sm text-ink-muted mt-0.5">
          Trend research → platform strategy → content variants → editable
          CapCut package → approval plan.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck size={15} className="text-accent" />
            Agent adapter boundary
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <p className="text-sm text-ink-muted">
            Internal rollout defaults to Hermes Agent / Omobono. White-label
            installs can register other compatible adapters without changing the
            campaign workflow.
          </p>
          <div className="flex flex-wrap gap-2">
            {adapters?.adapters.map((adapter) => (
              <Badge
                key={adapter.id}
                variant={
                  adapter.id === adapters.defaultAdapterId
                    ? 'default'
                    : 'secondary'
                }
              >
                {adapter.label} · {adapter.kind}
              </Badge>
            )) ?? (
              <span className="text-xs text-ink-muted">
                Waiting for embedded API…
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles size={15} className="text-accent" />
            Create campaign package
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="campaignTitle">Campaign title</Label>
              <Input
                id="campaignTitle"
                value={campaignTitle}
                onChange={(e) => setCampaignTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="niche">Trend niche</Label>
              <Input
                id="niche"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="objective">Objective / offer</Label>
            <Textarea
              id="objective"
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Platforms</Label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => togglePlatform(platform)}
                    className={cn(
                      'rounded-full border px-3 py-0.5 text-xs font-medium transition-colors',
                      platforms.includes(platform)
                        ? 'bg-accent/20 text-accent border-accent/40'
                        : 'border-border text-ink-muted hover:border-accent/30 hover:text-ink-base',
                    )}
                  >
                    {platform}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tone">Tone</Label>
              <Input
                id="tone"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              />
            </div>
          </div>

          <Button
            onClick={createPackage}
            loading={loading}
            disabled={
              !api ||
              platforms.length === 0 ||
              !campaignTitle ||
              !objective ||
              !niche
            }
          >
            Build Omobono package
          </Button>
        </CardContent>
      </Card>

      {packages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Approval queue / package history
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {packages.map((pkg) => (
              <div
                key={pkg.id}
                className="flex items-center gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-base">
                    {pkg.campaignTitle}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {pkg.niche} · {pkg.platforms.join(', ')} ·{' '}
                    {new Date(pkg.createdAt).toLocaleString()}
                  </p>
                </div>
                <Badge
                  variant={pkg.status === 'approved' ? 'success' : 'secondary'}
                >
                  {pkg.status}
                </Badge>
                {pkg.status === 'needs_approval' && (
                  <Button size="sm" onClick={() => approvePackage(pkg.id)}>
                    Approve
                  </Button>
                )}
                {(pkg.status === 'approved' || pkg.status === 'scheduled') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => markPublished(pkg)}
                  >
                    Mark published
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Trend brief</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <p className="text-xs text-ink-muted">
                Sources: {result.trendBrief.sources.join(', ') || 'none'}
              </p>
              {result.trendBrief.signals.map((signal) => (
                <div
                  key={signal.id}
                  className="rounded-md border border-border p-2"
                >
                  <p className="text-sm font-medium text-ink-base">
                    {signal.keyword}
                  </p>
                  <p className="text-xs text-ink-muted">
                    niche {signal.nicheScore}% · traffic{' '}
                    {signal.trafficScore ?? 'n/a'}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Film size={15} className="text-accent" />
                CapCut package
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <Badge variant="info">{result.capcutPackage.editingMode}</Badge>
              <p className="text-xs text-ink-muted">
                Manifest: {result.capcutPackage.manifestFileName}
              </p>
              <p className="text-xs text-ink-muted">
                Approval: {result.publishingPlan.gates.join(' → ')}
              </p>
              {result.capcutPackage.scenes.slice(0, 5).map((scene) => (
                <div
                  key={scene.id}
                  className="rounded-md border border-border p-2"
                >
                  <p className="text-xs font-semibold text-ink-base">
                    {scene.id} · {scene.durationSeconds}s
                  </p>
                  <p className="text-xs text-ink-muted">{scene.onScreenText}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
