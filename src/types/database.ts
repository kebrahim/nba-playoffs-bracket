/**
 * NBA Playoffs Bracket Challenge - Database Schema v1
 */

export enum SystemRole {
  SUPER_ADMIN = 'SuperAdmin',
  STANDARD = 'Standard',
}

export enum Conference {
  EAST = 'East',
  WEST = 'West',
}

export enum PickStatus {
  PENDING = 'Pending',
  CORRECT = 'Correct',
  INCORRECT = 'Incorrect',
}

export interface User {
  uid: string;
  displayName: string;
  email?: string;
  systemRole: SystemRole;
  joinedLeagueIds: string[];
}

export interface GlobalSettings {
  picksOpenTime: Date;
  picksLockTime: Date;
}

export interface Team {
  id: string; // Firestore Doc ID
  teamName: string;
  conference: Conference;
  seed: number; // 1-10
  apiTeamId: number; // For API-NBA mapping
}

export interface SeriesResult {
  id: string; // e.g., "Round1_East_1v8"
  round: number;
  team1Id: string;
  team2Id: string;
  advancingTeamId: string;
  eliminatedTeamId: string;
  totalGamesPlayed: number;
  actualFinalsTotalPoints?: number;
  lastDataChanged: Date;
}

export interface PointConfig {
  round1: number;
  round2: number;
  round3: number;
  finals: number;
  playIn: number;
  exactGamesBonus: number;
}

export interface League {
  id: string;
  leagueName: string;
  commissionerId: string;
  commissionerName?: string;
  inviteCode: string;
  lastCalculated: Date;
  pointConfig: PointConfig;
  participants: string[]; // Array of user UIDs
}

export interface Pick {
  matchupId: string; // e.g., "R1_E_1"
  predictedTeamId: string;
  predictedRound: number;
  predictedSeriesLength: number; // 4-7
  status: PickStatus;
}

export interface PlayInPick {
  matchupId: string; // e.g., "East_Game_A"
  predictedWinnerId: string;
  status: PickStatus;
}

export interface Bracket {
  id: string;
  userId: string;
  leagueId: string;
  picks: Pick[];
  playInPicks: PlayInPick[];
  tiebreakerPrediction: number; // Predicted total points in Finals
  totalScore?: number; // Calculated by scoring engine
  rank?: number; // Calculated by scoring engine
}
