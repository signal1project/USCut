import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Palette,
  Save,
  Globe,
  ExternalLink,
  Plus,
  Trash2,
  Building2,
} from 'lucide-react';
import { useMasApi } from './useMasApi';
import { ipc, hasIpc } from '@/lib/ipc';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
  Label,
  Textarea,
} from '@/components/ui';

interface BrandKitForm {
  id: string;
  name: string;
  bio: string;
  voice: string;
  audience: string;
  hashtags: string;
  bannedWords: string;
  signature: string;
}

const emptyBrand = (): BrandKitForm => ({
  id: crypto.randomUUID(),
  name: '',
  bio: '',
  voice: '',
  audience: '',
  hashtags: '',
  bannedWords: '',
  signature: '',
});

/**
 * Brand page: (1) Brand Kit — persistent voice/audience/hashtag rules injected
 * into every AI generation; (2) Bio Page — exports a static link-in-bio HTML
 * file ready to host anywhere.
 */
export default function BrandPage(): React.ReactElement {
  const api = useMasApi();
  const [brands, setBrands] = useState<BrandKitForm[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const kit = brands.find((brand) => brand.id === selectedId) ?? null;
  const [savingKit, setSavingKit] = useState(false);

  useEffect(() => {
    if (!hasIpc()) return;
    ipc
      .invoke('mas:brands:list')
      .then((raw) => {
        const profiles = raw as Array<{
          id: string;
          name: string;
          bio: string;
          voice: string;
          audience: string;
          hashtags: string[];
          bannedWords: string[];
          signature: string;
        }>;
        const forms = profiles.map((k) => ({
          id: k.id,
          name: k.name,
          bio: k.bio ?? '',
          voice: k.voice,
          audience: k.audience,
          hashtags: k.hashtags.join(' '),
          bannedWords: k.bannedWords.join(', '),
          signature: k.signature,
        }));
        setBrands(forms);
        if (forms[0]) setSelectedId(forms[0].id);
      })
      .catch(() => {});
  }, []);

  const saveKit = async () => {
    if (!hasIpc() || !kit || !kit.name.trim()) {
      toast.error('Enter a company name first');
      return;
    }
    setSavingKit(true);
    try {
      await ipc.invoke('mas:brands:save', {
        id: kit.id,
        name: kit.name.trim(),
        bio: kit.bio.trim(),
        voice: kit.voice.trim(),
        audience: kit.audience.trim(),
        hashtags: kit.hashtags.split(/\s+/).filter(Boolean),
        bannedWords: kit.bannedWords
          .split(',')
          .map((w) => w.trim())
          .filter(Boolean),
        signature: kit.signature.trim(),
      });
      toast.success(`${kit.name.trim()} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingKit(false);
    }
  };

  const updateKit = (changes: Partial<BrandKitForm>) => {
    setBrands((current) =>
      current.map((brand) =>
        brand.id === selectedId ? { ...brand, ...changes } : brand,
      ),
    );
  };

  const addBrand = () => {
    const brand = emptyBrand();
    setBrands((current) => [...current, brand]);
    setSelectedId(brand.id);
  };

  const deleteBrand = async () => {
    if (!kit || !hasIpc()) return;
    await ipc.invoke('mas:brands:delete', kit.id);
    const remaining = brands.filter((brand) => brand.id !== kit.id);
    setBrands(remaining);
    setSelectedId(remaining[0]?.id ?? '');
    toast.success(`${kit.name || 'Company'} removed`);
  };

  // ── Bio page ────────────────────────────────────────────────────────────────
  const [bioName, setBioName] = useState('');
  const [bioTagline, setBioTagline] = useState('');
  const [bioBrokerage, setBioBrokerage] = useState('');
  const [bioPhone, setBioPhone] = useState('');
  const [bioEmail, setBioEmail] = useState('');
  const [bioLinks, setBioLinks] = useState('');
  const [bioBusy, setBioBusy] = useState(false);
  const [bioResult, setBioResult] = useState<string | null>(null);

  const generateBio = async () => {
    if (!api || !bioName.trim()) return;
    setBioBusy(true);
    try {
      const links = bioLinks
        .split('\n')
        .map((line) => {
          const [label, ...rest] = line.split('|');
          return { label: (label ?? '').trim(), url: rest.join('|').trim() };
        })
        .filter((l) => l.label && l.url);
      const result = await api.generateBioPage({
        name: bioName.trim(),
        tagline: bioTagline.trim() || undefined,
        brokerage: bioBrokerage.trim() || undefined,
        phone: bioPhone.trim() || undefined,
        email: bioEmail.trim() || undefined,
        links,
      });
      setBioResult(result.path);
      toast.success('Bio page generated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setBioBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-strong">
          <Palette size={18} className="text-accent" />
          Brand
        </h2>
        <p className="text-sm text-ink-muted mt-0.5">
          Save a separate bio, voice, and content rules for every company you
          manage.
        </p>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {brands.map((brand) => (
          <button
            key={brand.id}
            onClick={() => setSelectedId(brand.id)}
            className={`shrink-0 flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${selectedId === brand.id ? 'border-accent bg-accent/10 text-ink-strong' : 'border-border text-ink-muted hover:text-ink-strong'}`}
          >
            <Building2 size={13} /> {brand.name || 'New company'}
          </button>
        ))}
        <Button variant="secondary" size="sm" onClick={addBrand}>
          <Plus size={13} /> Add Company
        </Button>
      </div>

      {/* Brand kit */}
      {kit && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Company Brand Profile</CardTitle>
            <CardDescription>
              These rules are appended to every AI content brief (posts,
              carousels, listing ads).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="companyName">Company / brand name</Label>
              <Input
                id="companyName"
                placeholder="Signal 1 Realty"
                value={kit.name}
                onChange={(e) => updateKit({ name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brandBio">Brand bio</Label>
              <Textarea
                id="brandBio"
                rows={5}
                placeholder="Describe the company, what it does, where it serves, its values, and what makes it different..."
                value={kit.bio}
                onChange={(e) => updateKit({ bio: e.target.value })}
              />
              <p className="text-[11px] text-ink-muted">
                Saved with this company so posts and ads can use the correct
                business context.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="voice">Voice &amp; tone</Label>
              <Input
                id="voice"
                placeholder="confident, warm, zero hype"
                value={kit.voice}
                onChange={(e) => updateKit({ voice: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audience">Target audience</Label>
              <Input
                id="audience"
                placeholder="first-time homebuyers in Houston"
                value={kit.audience}
                onChange={(e) => updateKit({ audience: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bhashtags">
                Preferred hashtags (space-separated)
              </Label>
              <Input
                id="bhashtags"
                placeholder="#HoustonHomes #YourBrand"
                value={kit.hashtags}
                onChange={(e) => updateKit({ hashtags: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="banned">Banned words (comma-separated)</Label>
              <Input
                id="banned"
                placeholder="cheap, guaranteed, once-in-a-lifetime"
                value={kit.bannedWords}
                onChange={(e) => updateKit({ bannedWords: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signature">Signature / CTA line</Label>
              <Input
                id="signature"
                placeholder="DM 'HOME' for a free buyer consult"
                value={kit.signature}
                onChange={(e) => updateKit({ signature: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Button
                onClick={() => void saveKit()}
                loading={savingKit}
                disabled={!hasIpc()}
              >
                <Save size={14} /> Save Company
              </Button>
              <Button
                variant="ghost"
                onClick={() => void deleteBrand()}
                className="text-danger hover:text-danger"
              >
                <Trash2 size={14} /> Remove Company
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!kit && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-ink-muted">
            Add your first company to create its brand bio and content rules.
          </CardContent>
        </Card>
      )}

      {/* Bio page generator */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Globe size={14} className="text-accent" />
            Link-in-Bio Page
          </CardTitle>
          <CardDescription>
            Exports a self-contained HTML file — host it on GitHub Pages, S3, or
            your site and link it from every profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              placeholder="Your name *"
              value={bioName}
              onChange={(e) => setBioName(e.target.value)}
            />
            <Input
              placeholder="Tagline"
              value={bioTagline}
              onChange={(e) => setBioTagline(e.target.value)}
            />
            <Input
              placeholder="Brokerage"
              value={bioBrokerage}
              onChange={(e) => setBioBrokerage(e.target.value)}
            />
            <Input
              placeholder="Phone"
              value={bioPhone}
              onChange={(e) => setBioPhone(e.target.value)}
            />
            <Input
              placeholder="Email"
              value={bioEmail}
              onChange={(e) => setBioEmail(e.target.value)}
              className="col-span-2"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biolinks">
              Links — one per line as: Label | https://url
            </Label>
            <Textarea
              id="biolinks"
              rows={4}
              placeholder={
                'Search Homes | https://example.com/search\nFree Home Valuation | https://example.com/value'
              }
              value={bioLinks}
              onChange={(e) => setBioLinks(e.target.value)}
            />
          </div>
          <Button
            onClick={() => void generateBio()}
            loading={bioBusy}
            disabled={!api || !bioName.trim()}
          >
            <ExternalLink size={14} />
            Generate Bio Page
          </Button>
          {bioResult && (
            <p className="text-xs text-success">
              Generated:{' '}
              <span className="text-ink-muted break-all select-all">
                {bioResult}
              </span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
