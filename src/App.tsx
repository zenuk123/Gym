import { lazy, Suspense, useEffect } from 'react';
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
import { FoodEditor, FoodsPage } from './features/nutrition/FoodsPage';
import { MealEditor, MealsPage } from './features/nutrition/MealsPage';
import { PlanPage } from './features/nutrition/PlanPage';
import { ShoppingPage } from './features/nutrition/ShoppingPage';
import { OverviewPage } from './features/progress/OverviewPage';
import { BodyPage } from './features/progress/BodyPage';
import { GoalsPage } from './features/progress/GoalsPage';
import { SleepPage } from './features/progress/sleep/SleepPage';
import { TrainingAnalytics } from './features/progress/TrainingAnalytics';
import { NutritionAnalytics } from './features/progress/NutritionAnalytics';
import { PhotosPage } from './features/progress/photos/PhotosPage';
import { ComparePage } from './features/progress/photos/ComparePage';
import { MorePage } from './features/more/MorePage';
import { ProfileSettings } from './features/more/ProfileSettings';
import { TargetsSettings } from './features/more/TargetsSettings';
import { AccountSettings } from './features/more/AccountSettings';
import { DataSettings } from './features/more/DataSettings';
import { AppearanceSettings } from './features/more/AppearanceSettings';
import { AboutPage } from './features/more/AboutPage';
import { ReviewPage } from './features/review/ReviewPage';
import { AiSettingsPage } from './features/coach/AiSettingsPage';
import { HealthImportPage } from './features/more/HealthImportPage';
import { FriendsPage } from './features/friends/FriendsPage';

// The coach pulls in the Anthropic SDK, so it loads only when opened.
const CoachPage = lazy(() => import('./features/coach/CoachPage').then((m) => ({ default: m.CoachPage })));
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
            <Route path="/nutrition/foods" element={<FoodsPage />} />
            <Route path="/nutrition/foods/:id" element={<FoodEditor />} />
            <Route path="/nutrition/meals" element={<MealsPage />} />
            <Route path="/nutrition/meals/:id" element={<MealEditor />} />
            <Route path="/nutrition/plan" element={<PlanPage profile={profile} />} />
            <Route path="/nutrition/shopping" element={<ShoppingPage />} />
            <Route path="/progress" element={<OverviewPage profile={profile} />} />
            <Route path="/progress/body" element={<BodyPage profile={profile} />} />
            <Route path="/progress/photos" element={<PhotosPage profile={profile} />} />
            <Route path="/progress/photos/compare" element={<ComparePage profile={profile} />} />
            <Route path="/progress/training" element={<TrainingAnalytics profile={profile} />} />
            <Route path="/progress/nutrition" element={<NutritionAnalytics profile={profile} />} />
            <Route path="/progress/goals" element={<GoalsPage profile={profile} />} />
            <Route path="/progress/sleep" element={<SleepPage />} />
            <Route path="/more" element={<MorePage profile={profile} />} />
            <Route path="/more/profile" element={<ProfileSettings profile={profile} />} />
            <Route path="/more/targets" element={<TargetsSettings profile={profile} />} />
            <Route path="/more/account" element={<AccountSettings />} />
            <Route path="/more/data" element={<DataSettings />} />
            <Route path="/more/appearance" element={<AppearanceSettings profile={profile} />} />
            <Route path="/more/about" element={<AboutPage />} />
            <Route path="/more/review" element={<ReviewPage profile={profile} />} />
            <Route path="/more/ai" element={<AiSettingsPage />} />
            <Route path="/more/health" element={<HealthImportPage profile={profile} />} />
            <Route path="/more/friends" element={<FriendsPage profile={profile} />} />
            <Route
              path="/more/coach"
              element={
                <Suspense fallback={<main className="page" />}>
                  <CoachPage profile={profile} />
                </Suspense>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          {!inGym && <BottomNav />}
        </>
      )}
    </>
  );
}
