import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { User, SystemRole } from '../types/database';

interface AuthContextType {
  user: FirebaseUser | null;
  userData: User | null;
  loading: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        // Listen to user data in Firestore for roles
        const userDocRef = doc(db, 'users', currentUser.uid);
        const unsubscribeDoc = onSnapshot(userDocRef, async (docSnap) => {
          if (docSnap.exists()) {
            setUserData(docSnap.data() as User);
          } else {
            // Default user data if not found
            // Check if this is the bootstrap admin email
            const isBootstrapAdmin = currentUser.email === 'kebrahim@gmail.com';
            
            const newUserData: User = {
              uid: currentUser.uid,
              displayName: currentUser.displayName || 'User',
              systemRole: isBootstrapAdmin ? SystemRole.SUPER_ADMIN : SystemRole.STANDARD,
              joinedLeagueIds: []
            };
            
            setUserData(newUserData);
            
            // Create the document in Firestore
            try {
              await setDoc(userDocRef, newUserData);
            } catch (err) {
              console.error("Error creating user document:", err);
            }
          }
          setLoading(false);
        }, (error) => {
          console.error("Error fetching user data:", error);
          setLoading(false);
        });

        return () => unsubscribeDoc();
      } else {
        setUserData(null);
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const isAdmin = userData?.systemRole === SystemRole.SUPER_ADMIN || user?.email === 'kebrahim@gmail.com';

  return (
    <AuthContext.Provider value={{ user, userData, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
