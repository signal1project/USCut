import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronDown } from 'lucide-react';
import { useActiveBrandStore } from '@/store/activeBrandStore';

/**
 * Global company scope switcher. Lives on Home; the selection it writes
 * (mas:brands:set-active) is read by Publish/Share/Scheduler to filter which
 * accounts and Pages show up, and by AI content generation to pick which
 * company's brand voice gets injected into briefs. "All companies" (the
 * default) reproduces the original unfiltered, single-company behavior.
 */
const CompanySwitcher: React.FC = () => {
  const navigate = useNavigate();
  const { brands, activeBrandId, loaded, load, setActive } =
    useActiveBrandStore();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (loaded && brands.length === 0) {
    return (
      <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#131316] border border-[#1d1d22]">
        <div className="flex items-center gap-2 text-[12px] text-[#9a9aa6]">
          <Building2 size={14} className="text-[#5a5a66]" />
          No companies yet — add one to filter Publish/Share by business.
        </div>
        <button
          onClick={() => navigate('/mas/brand')}
          className="text-[11px] font-medium text-[#4d7cff] hover:underline shrink-0"
        >
          Add company →
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#131316] border border-[#1d1d22]">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#4d7cff]/10 text-[#4d7cff] shrink-0">
          <Building2 size={15} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-[#5a5a66] uppercase tracking-wider">
            Working as
          </p>
          <div className="relative">
            <select
              value={activeBrandId ?? ''}
              onChange={(e) => void setActive(e.target.value || null)}
              className="appearance-none bg-transparent text-[13px] font-semibold text-[#e8e8f0] pr-5 focus:outline-none cursor-pointer max-w-[220px] truncate"
            >
              <option value="" className="bg-[#161619]">
                All companies
              </option>
              {brands.map((b) => (
                <option key={b.id} value={b.id} className="bg-[#161619]">
                  {b.name || 'Unnamed company'}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="absolute right-0 top-1/2 -translate-y-1/2 text-[#5a5a66] pointer-events-none"
            />
          </div>
        </div>
      </div>
      <button
        onClick={() => navigate('/mas/brand')}
        className="text-[11px] text-[#71717f] hover:text-[#c8c8d2] transition-colors shrink-0"
      >
        Manage companies →
      </button>
    </div>
  );
};

export default CompanySwitcher;
