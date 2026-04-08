import React, { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth } from '../firebase';
import { Trophy, Mail, ArrowLeft, Send } from 'lucide-react';

export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage('Check your email for password reset instructions.');
    } catch (err: any) {
      console.error("Reset password error:", err);
      if (err.code === 'auth/user-not-found') {
        setError('No user found with this email.');
      } else {
        setError('An error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="text-center space-y-4">
          <div className="inline-block bg-orange-500 p-4 rounded-2xl shadow-[0_0_30px_rgba(245,132,38,0.3)]">
            <Trophy className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black uppercase italic tracking-tighter">
            NBA <span className="text-orange-500">Playoffs</span> Bracket
          </h1>
          <p className="text-gray-400 font-medium">Reset your password</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          <form onSubmit={handleResetPassword} className="space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-sm text-center">
                {error}
              </div>
            )}
            {message && (
              <div className="p-3 bg-green-500/10 border border-green-500/50 rounded-xl text-green-400 text-sm text-center">
                {message}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-gray-500 ml-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-all"
                  placeholder="name@example.com"
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-4 rounded-xl transition-all shadow-xl shadow-orange-500/20 flex items-center justify-center gap-2 uppercase italic"
            >
              {loading ? 'Sending...' : <><Send className="w-5 h-5" /> Send Reset Link</>}
            </button>
          </form>

          <div className="mt-8 text-center">
            <Link to="/login" title="Back to Login" className="text-sm font-bold text-gray-500 hover:text-white transition-colors flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
