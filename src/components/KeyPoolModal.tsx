import React, { useState, useEffect } from 'react';
import {
  X,
  KeyRound,
  Zap,
  ExternalLink,
  Plus,
  CheckCircle2,
  Trash2,
  ShieldCheck,
  AlertCircle,
  Clock,
  Sparkles,
  Copy,
  Check,
  Eye,
  EyeOff,
} from 'lucide-react';

export const LOCAL_STORAGE_KEY_POOL = 'bangla_epub_gemini_keys';

interface KeyPoolStatus {
  totalKeys: number;
  totalCapacityRpm: number;
  keys: Array<{
    id: number;
    masked: string;
    status: 'active' | 'cooldown';
    cooldownRemainingSec: number;
    isCustom?: boolean;
  }>;
  customKeys?: string[];
  customKeysCount?: number;
}

interface KeyPoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeysUpdated?: () => void;
}

export const KeyPoolModal: React.FC<KeyPoolModalProps> = ({
  isOpen,
  onClose,
  onKeysUpdated,
}) => {
  const [newKeyInput, setNewKeyInput] = useState('');
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const [poolStatus, setPoolStatus] = useState<KeyPoolStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Load keys from localStorage
  const loadLocalKeys = (): string[] => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY_POOL);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.filter((k) => typeof k === 'string' && k.trim().length > 10);
        }
      }
    } catch (e) {
      console.warn('Error reading localStorage keys:', e);
    }
    return [];
  };

  // Save keys to localStorage
  const persistLocalKeys = (keys: string[]) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_POOL, JSON.stringify(keys));
    } catch (e) {
      console.warn('Error saving to localStorage:', e);
    }
  };

  // Fetch status and sync keys between localStorage and server
  const fetchStatusAndSync = async () => {
    const localKeys = loadLocalKeys();
    setSavedKeys(localKeys);

    try {
      // If we have local keys, sync them to server
      let res;
      if (localKeys.length > 0) {
        res = await fetch('/api/key-pool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: localKeys }),
        });
      } else {
        res = await fetch('/api/key-pool');
      }

      if (res.ok) {
        const data = await res.json();
        setPoolStatus({
          totalKeys: data.totalKeys || 1,
          totalCapacityRpm: data.totalCapacityRpm || 15,
          keys: data.keys || [],
          customKeys: data.customKeys || [],
          customKeysCount: data.customKeysCount || 0,
        });

        // Sync strictly with validated customKeys from server (cleans out any quarantined/invalid keys)
        if (Array.isArray(data.customKeys)) {
          setSavedKeys(data.customKeys);
          persistLocalKeys(data.customKeys);
        }
      }
    } catch (e) {
      console.warn('Failed to sync key pool status:', e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatusAndSync();
      setMessage(null);
      setNewKeyInput('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Add a single key permanently
  const handleAddKey = async () => {
    const trimmed = newKeyInput.trim();
    if (!trimmed) {
      setMessage({
        type: 'error',
        text: 'অনুগ্রহ করে একটি জেমিনাই এআই কী দিন।',
      });
      return;
    }

    if (trimmed.length < 15) {
      setMessage({
        type: 'error',
        text: 'প্রদত্ত কী-টি অত্যন্ত ছোট। একটি সঠিক জেমিনাই API কী দিন (সাধারণত AIzaSy... দিয়ে শুরু হয়)।',
      });
      return;
    }

    if (savedKeys.includes(trimmed)) {
      setMessage({
        type: 'error',
        text: 'এই এআই কী-টি ইতিমধ্যে আপনার তালিকায় যুক্ত ও সংরক্ষিত আছে!',
      });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    const updated = [...savedKeys, trimmed];

    try {
      // 1. Permanently save to localStorage
      persistLocalKeys(updated);
      setSavedKeys(updated);

      // 2. Persist to server backend pool
      const res = await fetch('/api/key-pool/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmed }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPoolStatus({
          totalKeys: data.totalKeys,
          totalCapacityRpm: data.totalCapacityRpm,
          keys: data.keys || [],
          customKeys: data.customKeys || updated,
          customKeysCount: data.customKeysCount || updated.length,
        });
        setNewKeyInput('');
        setMessage({
          type: 'success',
          text: `🎉 নতুন কী সফলভাবে যুক্ত ও স্থায়ীভাবে সেভ হয়েছে! বর্তমান মোট কোটা: ${data.totalCapacityRpm} পাতা/মিনিট। আপনি চাইলে আরও কী যুক্ত করতে পারেন।`,
        });
        if (onKeysUpdated) onKeysUpdated();
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'কী সার্ভারে যুক্ত করতে সমস্যা হয়েছে।',
        });
      }
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: 'সার্ভারে সংরক্ষণ করতে সমস্যা হয়েছে: ' + (err.message || 'Error'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Remove a single key
  const handleRemoveKey = async (keyToRemove: string) => {
    setIsLoading(true);
    setMessage(null);

    const updated = savedKeys.filter((k) => k !== keyToRemove);

    try {
      // 1. Update localStorage
      persistLocalKeys(updated);
      setSavedKeys(updated);

      // 2. Update server
      const res = await fetch('/api/key-pool/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyToRemove }),
      });

      const data = await res.json();
      if (res.ok) {
        setPoolStatus({
          totalKeys: data.totalKeys,
          totalCapacityRpm: data.totalCapacityRpm,
          keys: data.keys || [],
          customKeys: data.customKeys || updated,
          customKeysCount: data.customKeysCount || updated.length,
        });
        setMessage({
          type: 'success',
          text: 'কী সফলভাবে তালিকা থেকে মুছে ফেলা হয়েছে।',
        });
        if (onKeysUpdated) onKeysUpdated();
      }
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: 'কী মুছতে সমস্যা হয়েছে: ' + (err.message || 'Error'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Reset all custom keys back to default
  const handleResetToDefault = async () => {
    if (
      !confirm(
        'আপনি কি সব কাস্টম কী মুছে ফেলে শুধুমাত্র সিস্টেমের ডিফল্ট কী-তে ফিরে যেতে চান?'
      )
    ) {
      return;
    }

    setIsLoading(true);
    try {
      persistLocalKeys([]);
      setSavedKeys([]);

      const res = await fetch('/api/key-pool', { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setPoolStatus({
          totalKeys: data.totalKeys || 1,
          totalCapacityRpm: data.totalCapacityRpm || 15,
          keys: data.keys || [],
          customKeys: [],
          customKeysCount: 0,
        });
        setMessage({
          type: 'success',
          text: 'সব কাস্টম কী মুছে ফেলা হয়েছে। সিস্টেম ডিফল্ট কী সক্রিয় আছে।',
        });
        if (onKeysUpdated) onKeysUpdated();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'রিসেট করতে ব্যর্থ হয়েছে।' });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (keyStr: string) => {
    navigator.clipboard.writeText(keyStr);
    setCopiedKey(keyStr);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const maskKey = (keyStr: string) => {
    if (keyStr.length <= 10) return 'AIzaSy...';
    return `${keyStr.substring(0, 8)}...${keyStr.substring(keyStr.length - 4)}`;
  };

  const totalCapacity = poolStatus?.totalCapacityRpm || 15;
  const totalKeys = poolStatus?.totalKeys || 1;
  const customCount = savedKeys.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden text-slate-800 dark:text-slate-100 transition-colors">
        {/* Header */}
        <div className="p-3.5 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-indigo-50/90 dark:from-slate-900 via-white dark:via-slate-900 to-purple-50/90 dark:to-slate-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-200 dark:shadow-indigo-950 flex-shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-sm sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                  মাল্টিপল জেমিনাই এআই কী কোটা ম্যানেজার
                </h2>
                <span className="text-[11px] sm:text-xs bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200 font-bold px-2 py-0.5 rounded-full border border-indigo-300 dark:border-indigo-700 flex-shrink-0">
                  {totalCapacity} RPM
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 font-medium mt-0.5 line-clamp-1 sm:line-clamp-none">
                একাধিক জিমেইল অ্যাকাউন্টের কী দিয়ে রূপান্তরের গতি ও কোটা বহুগুণ বাড়ান।
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Active Capacity Summary Banner */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-xl p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-indigo-800">
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-400 fill-current" />
                <span>বর্তমান সিস্টেমের মোট ক্ষমতা ও গতি</span>
              </div>
              <div className="text-xl sm:text-2xl font-black text-white flex flex-wrap items-center gap-2">
                <span>{totalCapacity} পাতা / মিনিট</span>
                <span className="text-xs font-semibold text-indigo-100 bg-white/20 px-3 py-0.5 rounded-full border border-white/20">
                  {totalKeys}টি সক্রিয় চ্যানেল ({customCount}টি কাস্টম + ১টি ডিফল্ট)
                </span>
              </div>
              <div className="text-xs text-indigo-100 font-medium">
                প্রতিটি নতুন জিমেইল অ্যাকাউন্ট যোগ করলে আপনার ফ্রি লিমিট প্রতি মিনিটে আরও ১৫টি পাতা করে বৃদ্ধি পায়।
              </div>
            </div>

            {/* Multiplier Badge */}
            <div className="bg-white/10 backdrop-blur-xs border border-white/25 rounded-xl px-4 py-2.5 text-center self-stretch sm:self-auto flex sm:flex-col items-center justify-between sm:justify-center">
              <span className="text-xs text-indigo-200 font-semibold">গতি গুণক</span>
              <span className="text-xl font-black text-amber-300">{totalKeys}X স্পিড</span>
            </div>
          </div>

          {/* Large Book Scaling Advice */}
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-3.5 text-xs text-emerald-950 dark:text-emerald-100 space-y-1.5">
            <div className="font-bold flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>১৮০–৩০০ পৃষ্ঠার বড় বই রূপান্তর নির্দেশিকা (Zero Rate Limit Formula):</span>
            </div>
            <p className="leading-relaxed">
              গুগল জেমিনাই ফ্রি টিয়ারে প্রতি অ্যাকাউন্টে প্রতি মিনিটে সর্বোচ্চ ১৫টি রিকোয়েস্ট অনুমোদন করে।
              আমাদের নতুন গ্লোবাল পেসিং সিস্টেম স্বয়ংক্রিয়ভাবে রেট-লিমিটের নিচে রিকোয়েস্ট পরিচালনা করে, ফলে কোনো পাতা রেড/এরর হবে না।
              ১৮০ পৃষ্ঠার বই ১টি কী দিয়ে স্ক্যান করতে ~১২ মিনিট সময় লাগে। <strong>২টি কী যোগ করলে মাত্র ৬ মিনিট</strong> এবং <strong>৩টি কী যোগ করলে মাত্র ৪ মিনিটে</strong> পুরো বই নির্ভুলভাবে স্ক্যান সম্পন্ন হবে!
            </p>
          </div>

          {/* Dedicated Input Field: Add a Key */}
          <div className="bg-slate-50 dark:bg-slate-800/80 rounded-xl p-4 sm:p-5 border border-slate-300 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>নতুন জেমিনাই এআই কী যুক্ত করুন (Add Gemini API Key):</span>
              </label>
              <span className="text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-2.5 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-700 font-semibold">
                স্থায়ীভাবে ব্রাউজারে সংরক্ষিত থাকবে
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddKey();
                  }
                }}
                placeholder="আপনার এআই কী পেস্ট করুন (যেমন: AIzaSy...)"
                disabled={isLoading}
                className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm font-mono bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-2 border-slate-300 dark:border-slate-600 rounded-xl focus:outline-none focus:border-indigo-600 shadow-2xs placeholder:text-slate-500 dark:placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={handleAddKey}
                disabled={isLoading || !newKeyInput.trim()}
                className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm shadow-md shadow-indigo-200 dark:shadow-indigo-950 transition-all active:scale-95 disabled:opacity-50 flex-shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>{isLoading ? 'যুক্ত হচ্ছে...' : 'কী যুক্ত করুন'}</span>
              </button>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 p-3 rounded-lg text-xs sm:text-sm text-slate-800 dark:text-amber-100 font-medium leading-relaxed">
              💡 <strong>পদ্ধতি:</strong> কী পেস্ট করে <strong>"কী যুক্ত করুন"</strong> বাটনে চাপুন। এটি সাথে সাথে সেভ হয়ে যাবে। এরপর একইভাবে যতখুশি ৩য়, ৪র্থ বা ১০ম কী-ও যুক্ত করতে পারবেন।
            </div>
          </div>

          {/* Feedback Message Toast */}
          {message && (
            <div
              className={`p-3.5 rounded-xl text-xs sm:text-sm flex items-center gap-2.5 ${
                message.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-100 border border-emerald-300 dark:border-emerald-700 font-bold'
                  : 'bg-rose-50 dark:bg-rose-950/70 text-rose-900 dark:text-rose-100 border border-rose-300 dark:border-rose-700 font-bold'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {/* Saved Keys Itemized List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>সংরক্ষিত সক্রিয় কী-সমূহ (Active Key Channels):</span>
              </h3>
              <span className="text-xs text-slate-700 dark:text-slate-300 font-bold bg-slate-200 dark:bg-slate-700 px-2.5 py-0.5 rounded-full">
                মোট {totalKeys}টি সক্রিয় চ্যানেল
              </span>
            </div>

            <div className="space-y-2.5">
              {/* Default System Key Item */}
              <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800/90 px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs sm:text-sm shadow-xs">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs flex-shrink-0">
                    #১
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 sm:gap-2 flex-wrap">
                      <span className="truncate">সিস্টেম ডিফল্ট চ্যানেল</span>
                      <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded font-bold">
                        বিল্ট-ইন
                      </span>
                    </div>
                    <div className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
                      AIzaSy... (সিস্টেম সুরক্ষিত)
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 ml-1">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-2 sm:px-2.5 py-1 rounded-full border border-emerald-300 dark:border-emerald-700">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="hidden xs:inline">১৫ RPM প্রস্তুত</span>
                    <span className="xs:hidden">১৫ RPM</span>
                  </span>
                </div>
              </div>

              {/* User Added Custom Keys */}
              {savedKeys.map((k, idx) => {
                const isRevealed = revealedKeys[k];
                const isCopied = copiedKey === k;

                return (
                  <div
                    key={k}
                    className="flex items-center justify-between bg-white dark:bg-slate-800/95 px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl border border-indigo-200 dark:border-indigo-800 hover:border-indigo-400 text-xs sm:text-sm shadow-xs transition-colors"
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-xs">
                        #{idx + 2}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <span>কাস্টম কী #{idx + 1}</span>
                          <span className="text-xs bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 font-bold px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800">
                            +১৫ RPM
                          </span>
                        </div>
                        <div className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[120px] xs:max-w-[180px] sm:max-w-[320px]">
                          {isRevealed ? k : maskKey(k)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0 ml-1">
                      {/* Show/Hide Button */}
                      <button
                        type="button"
                        onClick={() =>
                          setRevealedKeys((prev) => ({ ...prev, [k]: !prev[k] }))
                        }
                        className="p-1.5 sm:p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                        title={isRevealed ? 'লুকান' : 'দেখুন'}
                      >
                        {isRevealed ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>

                      {/* Copy Button */}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(k)}
                        className="p-1.5 sm:p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-600 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                        title="কপি করুন"
                      >
                        {isCopied ? (
                          <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>

                      {/* Delete this key button */}
                      <button
                        type="button"
                        onClick={() => handleRemoveKey(k)}
                        disabled={isLoading}
                        className="p-1.5 sm:p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded-lg transition-colors cursor-pointer"
                        title="এই কী-টি মুছে ফেলুন"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {savedKeys.length === 0 && (
                <div className="text-center py-7 px-6 bg-slate-50 dark:bg-slate-800/90 rounded-2xl border-2 border-dashed border-indigo-200 dark:border-indigo-900/60 shadow-xs space-y-2">
                  <div className="w-10 h-10 mx-auto rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    এখনো কোনো কাস্টম কী যোগ করা হয়নি
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200 font-medium max-w-lg mx-auto leading-relaxed">
                    উপরের বাক্সে আপনার অতিরিক্ত জিমেইল অ্যাকাউন্টের কী পেস্ট করে <strong className="text-indigo-600 dark:text-indigo-400 font-bold underline decoration-indigo-300">"কী যুক্ত করুন"</strong> বাটনে চাপুন। প্রতিটি কী-তে আরও ১৫ RPM গতি যোগ হবে।
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Guide with Google AI Studio Direct Link */}
          <div className="bg-indigo-50/90 dark:bg-slate-800/95 rounded-2xl p-5 sm:p-6 border border-indigo-200 dark:border-indigo-800/80 shadow-xs space-y-4">
            <div className="font-bold text-base sm:text-lg text-indigo-950 dark:text-white flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-indigo-600 text-white">
                <Sparkles className="w-4 h-4" />
              </div>
              <span>কীভাবে ফ্রি জেমিনাই এআই কী সংগ্রহ করবেন?</span>
            </div>

            <div className="space-y-3 text-sm text-slate-800 dark:text-slate-100 leading-relaxed font-medium">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5 shadow-xs">
                  ১
                </span>
                <p>
                  আপনার যেকোনো অতিরিক্ত জিমেইল অ্যাকাউন্টে ব্রাউজারে লগইন করুন (ফ্রি টিয়ারে কোনো চার্জ নেই)।
                </p>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5 shadow-xs">
                  ২
                </span>
                <div className="space-y-2 flex-1">
                  <p>নিচের সরাসরি লিংকে ক্লিক করে অফিসিয়াল গুগল এআই স্টুডিওতে যান:</p>
                  <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm shadow-md shadow-indigo-200 dark:shadow-indigo-950 transition-all hover:scale-[1.02] active:scale-95"
                    >
                      <span>Google AI Studio থেকে API Key তৈরি করুন</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <span className="text-xs font-mono font-bold text-indigo-900 dark:text-indigo-200 bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 shadow-2xs">
                      https://aistudio.google.com/apikey
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5 shadow-xs">
                  ৩
                </span>
                <p>
                  সেখানে <strong className="text-indigo-600 dark:text-indigo-400 font-bold">"Create API key"</strong> বাটনে ক্লিক করে পাওয়া কী কপি করে উপরের ইনপুট বক্সে পেস্ট করে <strong className="text-indigo-600 dark:text-indigo-400 font-bold">"কী যুক্ত করুন"</strong> বাটনে চাপুন।
                </p>
              </div>
            </div>

            <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 font-medium pt-3 border-t border-indigo-200 dark:border-slate-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <span>একবার যুক্ত করলেই এটি ব্রাউজারে স্থায়ীভাবে সেভ থাকবে এবং রিলোড করলেও হারাবে না।</span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/80 flex items-center justify-between gap-2">
          {savedKeys.length > 0 ? (
            <button
              type="button"
              onClick={handleResetToDefault}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 border border-rose-300 dark:border-rose-800 transition-colors disabled:opacity-50"
              title="সব কাস্টম কী মুছে ফেলে ডিফল্ট সিস্টেমে ফিরুন"
            >
              <Trash2 className="w-4 h-4" />
              <span>সব কাস্টম কী মুছে ফেলুন</span>
            </button>
          ) : (
            <div className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>ডিফল্ট চ্যানেল সবসময় সচল</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-sm"
            >
              সম্পন্ন / বন্ধ করুন
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
