import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Trophy, ShieldCheck, Loader2 } from 'lucide-react';
import { LeagueLobby } from './components/LeagueLobby';
import { LeagueBracketView } from './components/LeagueBracketView';
import { SuperAdminDash } from './components/SuperAdminDash';
import { CommissionerDash } from './components/CommissionerDash';
import { Login } from './components/Login';
import { SignUp } from './components/SignUp';
import { ForgotPassword } from './components/ForgotPassword';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useState, useEffect } from 'react';
import { db, auth } from './firebase';
import { doc, getDocFromServer, collection, query, where, onSnapshot, addDoc, updateDoc, arrayUnion, getDocs } from 'firebase/firestore';
import { League } from './types/database';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Real Hook
const useLeagues = (userId: string | undefined, joinedLeagueIds: string[] = []) => {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  // Memoize the IDs to prevent infinite loops from array reference changes
  const leagueIdsString = JSON.stringify(joinedLeagueIds);

  useEffect(() => {
    const ids = JSON.parse(leagueIdsString);
    if (!userId || !ids || ids.length === 0) {
      setLeagues([]);
      setLoading(false);
      return;
    }

    const leaguesQuery = query(
      collection(db, 'leagues'),
      where('__name__', 'in', ids.slice(0, 10))
    );

    const unsubscribe = onSnapshot(leaguesQuery, (snapshot) => {
      setLeagues(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as League)));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userId, leagueIdsString]);

  return { leagues, loading };
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, userData, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          setConnectionError("Please check your Firebase configuration. The client is offline.");
        }
      }
    }
    testConnection();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans selection:bg-orange-500/30">
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div 
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => navigate('/')}
            >
              <div className="bg-orange-500 p-2 rounded-lg shadow-[0_0_15px_rgba(245,132,38,0.4)]">
                <Trophy className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tighter uppercase italic">
                NBA <span className="text-orange-500">Playoffs</span> Bracket
              </h1>
            </div>
            
            {isAdmin && (
              <button 
                onClick={() => navigate('/admin')}
                className="text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-500/10 border border-red-500/30 px-3 py-1 rounded-full hover:bg-red-500/20 transition-all"
              >
                Super Admin
              </button>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400 hidden sm:inline">{userData?.displayName || user.email}</span>
                <button 
                  onClick={() => auth.signOut()}
                  className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full transition-all"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button 
                onClick={() => navigate('/login')}
                className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-6 py-2 rounded-full transition-all transform hover:scale-105 shadow-lg shadow-orange-500/20"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        {connectionError && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-sm flex items-center gap-3">
            <ShieldCheck className="w-5 h-5" />
            {connectionError}
          </div>
        )}
        {children}
      </main>
    </div>
  );
};

const LobbyView = () => {
  const { user, userData } = useAuth();
  const navigate = useNavigate();
  const { leagues } = useLeagues(user?.uid, userData?.joinedLeagueIds);

  const handleJoinLeague = async (code: string) => {
    if (!user || !code) return;
    try {
      const q = query(collection(db, 'leagues'), where('inviteCode', '==', code.toUpperCase()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        alert("Invalid invite code.");
        return;
      }

      const leagueId = querySnapshot.docs[0].id;

      if (userData?.joinedLeagueIds.includes(leagueId)) {
        // Already in, just navigate
        navigate(`/league/${leagueId}`);
        return;
      }

      await updateDoc(doc(db, 'leagues', leagueId), {
        participants: arrayUnion(user.uid)
      });

      await updateDoc(doc(db, 'users', user.uid), {
        joinedLeagueIds: arrayUnion(leagueId)
      });

      navigate(`/league/${leagueId}`);
    } catch (error) {
      console.error("Error joining league:", error);
      try {
        handleFirestoreError(error, OperationType.UPDATE, 'leagues');
      } catch (e) {
        // Error already logged
      }
    }
  };

  useEffect(() => {
    const pendingCode = sessionStorage.getItem('pendingInviteCode');
    if (pendingCode && user && userData) {
      sessionStorage.removeItem('pendingInviteCode');
      handleJoinLeague(pendingCode);
    }
  }, [user, userData]);

  const handleCreateLeague = async () => {
    if (!user) return;
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      const leagueRef = await addDoc(collection(db, 'leagues'), {
        leagueName: `${userData?.displayName || 'My'}'s League`,
        commissionerId: user.uid,
        inviteCode,
        participants: [user.uid],
        pointConfig: {
          round1: 10,
          round2: 20,
          round3: 40,
          finals: 80,
          playIn: 5,
          exactGamesBonus: 5
        },
        lastCalculated: new Date()
      });

      await updateDoc(doc(db, 'users', user.uid), {
        joinedLeagueIds: arrayUnion(leagueRef.id)
      });
      
      navigate(`/league/${leagueRef.id}`);
    } catch (error) {
      console.error("Error creating league:", error);
      try {
        handleFirestoreError(error, OperationType.CREATE, 'leagues');
      } catch (e) {
        // Error already logged
      }
    }
  };

  return (
    <LeagueLobby 
      leagues={leagues}
      onJoinLeague={handleJoinLeague}
      onCreateLeague={handleCreateLeague}
      onSelectLeague={(id) => navigate(`/league/${id}`)}
    />
  );
};

const JoinLeagueHandler = () => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;

    if (inviteCode) {
      sessionStorage.setItem('pendingInviteCode', inviteCode.toUpperCase());
    }

    if (!user) {
      navigate('/signup');
    } else {
      navigate('/');
    }
  }, [user, loading, inviteCode, navigate]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
      <Loader2 className="w-12 h-12 text-orange-500 animate-spin" />
      <p className="text-orange-500 font-black uppercase tracking-widest animate-pulse">Joining League...</p>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/join/:inviteCode" element={<JoinLeagueHandler />} />
            
            <Route path="/" element={
              <ProtectedRoute>
                <Layout>
                  <LobbyView />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/league/:leagueId" element={
              <ProtectedRoute>
                <Layout>
                  <LeagueBracketView />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/league/:leagueId/settings" element={
              <ProtectedRoute>
                <Layout>
                  <CommissionerDash />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/admin" element={
              <ProtectedRoute requireAdmin>
                <Layout>
                  <SuperAdminDash />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}
