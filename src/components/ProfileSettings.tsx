import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { User as UserIcon, Save, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const ProfileSettings: React.FC = () => {
  const { user, userData } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(userData?.displayName || '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !displayName.trim()) return;

    setLoading(true);
    setMessage(null);

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: displayName.trim()
      });
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (error) {
      console.error("Error updating profile:", error);
      setMessage({ type: 'error', text: 'Failed to update profile. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-12 px-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <button 
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors mb-8 group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        <span className="text-[10px] font-black uppercase tracking-widest">Back</span>
      </button>

      <div className="bg-white/70 backdrop-blur-xl border border-black/10 rounded-[2.5rem] p-8 md:p-12 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-orange-500/20 to-transparent" />
        
        <div className="flex items-center gap-4 mb-12">
          <div className="bg-orange-500/10 p-4 rounded-3xl border border-orange-500/20">
            <UserIcon className="w-8 h-8 text-orange-500" />
          </div>
          <div>
            <h1 className="text-3xl font-black uppercase italic tracking-tighter text-gray-900">Profile <span className="text-orange-500">Settings</span></h1>
            <p className="text-gray-500 font-medium uppercase tracking-widest text-[10px]">Customize your tournament identity</p>
          </div>
        </div>

        {message && (
          <div className={`mb-8 p-4 rounded-2xl border flex items-center gap-3 animate-in fade-in zoom-in duration-300 ${
            message.type === 'success' ? 'bg-green-500/10 border-green-500/50 text-green-600' : 'bg-red-500/10 border-red-500/50 text-red-600'
          }`}>
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="text-sm font-bold">{message.text}</span>
          </div>
        )}

        <form onSubmit={handleUpdateProfile} className="space-y-8">
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">
              Display Name
            </label>
            <div className="relative group">
              <input 
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name..."
                className="w-full bg-black/5 border border-black/10 rounded-2xl px-6 py-4 text-lg font-black focus:border-orange-500/50 outline-none transition-all placeholder:text-gray-300 text-gray-900"
                maxLength={25}
              />
              <div className="absolute inset-0 rounded-2xl border-2 border-orange-500/0 group-focus-within:border-orange-500/10 pointer-events-none transition-all" />
            </div>
            <p className="text-[10px] text-gray-400 font-medium ml-1">
              This is how you will appear on leaderboards and in contests.
            </p>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">
              Email Address
            </label>
            <div className="w-full bg-black/5 border border-black/5 rounded-2xl px-6 py-4 text-sm font-bold text-gray-400 cursor-not-allowed">
              {user?.email}
            </div>
            <p className="text-[10px] text-gray-400 font-medium ml-1 italic">
              Email cannot be changed.
            </p>
          </div>

          <button 
            type="submit"
            disabled={loading || !displayName.trim() || displayName === userData?.displayName}
            className="w-full bg-orange-500 text-white py-5 rounded-2xl font-black uppercase italic tracking-widest hover:bg-orange-600 transition-all shadow-xl shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Changes
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
