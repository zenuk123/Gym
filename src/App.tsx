import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { useProfile } from './db/hooks';
import { Onboarding } from './features/onboarding/Onboarding';
import { TodayPage } from './features/today/TodayPage';
import { WorkoutPage } from './features/workout/WorkoutPage';
import { RoutineEditor } from './features/workout/RoutineEditor';
import { SessionPage } from './features/workout/SessionPage';
import { HistoryPage } from './features/workout/HistoryPage';
import { ExerciseDetail, ExerciseLibrary } from './features/workout/ExerciseLibrary';
import { GymMode } from './features/workout/gym/GymMode';
import { NutritionPage } from './features/nutrition/NutritionPage';
import { ProgressPage } from './features/progress/ProgressPage';
import { MorePage } from './features/more/MorePage';
import { ProfileSettings } from './features/more/ProfileSettings';
import { TargetsSettings } from './features/more/TargetsSettings';
import { AccountSettings } from './features/more/AccountSettings';
import { DataSettings } from './features/more/DataSettings';
import { AppearanceSettings } from './features/more/AppearanceSettings';
import { AboutPage } from './features/more/AboutPage';
import { UpdatePrompt } from './pwa/UpdatePrompt';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export function App() {
  const profile = useProfile();
  const { pathname } = useLocation();
  const inGym = pathname === '/gym';

  return (
    <>
      <div className="status-scrim" />
      <UpdatePrompt />
      {profile === undefined ? (
        <div className="boot-splash" aria-hidden="true" />
      ) : profile === null ? (
        <Onboarding />
      ) : (
        <>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<TodayPage profile={profile} />} />
            <Route path="/workout" element={<WorkoutPage profile={profile} />} />
            <Route path="/workout/routine/:id" element={<RoutineEditor profile={profile} />} />
            <Route path="/workout/session/:id" element={<SessionPage profile={profile} />} />
            <Route path="/workout/summary/:id" element={<SessionPage profile={profile} celebrate />} />
            <Route path="/workout/history" element={<HistoryPage profile={profile} />} />
            <Route path="/workout/exercises" element={<ExerciseLibrary profile={profile} />} />
            <Route path="/workout/exercises/:id" element={<ExerciseDetail profile={profile} />} />
            <Route path="/gym" element={<GymMode profile={profile} />} />
            <Route path="/nutrition" element={<NutritionPage profile={profile} />} />
            <Route path="/progress" element={<ProgressPage profile={profile} />} />
            <Route path="/more" element={<MorePage profile={profile} />} />
            <Route path="/more/profile" element={<ProfileSettings profile={profile} />} />
            <Route path="/more/targets" element={<TargetsSettings profile={profile} />} />
            <Route path="/more/account" element={<AccountSettings />} />
            <Route path="/more/data" element={<DataSettings />} />
            <Route path="/more/appearance" element={<AppearanceSettings profile={profile} />} />
            <Route path="/more/about" element={<AboutPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          {!inGym && <BottomNav />}
        </>
      )}
    </>
  );
}
