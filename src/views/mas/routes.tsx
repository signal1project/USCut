import React from 'react';
import PublishPage from './PublishPage';
import ContentPage from './ContentPage';
import AnalyticsPage from './AnalyticsPage';
import EngagementPage from './EngagementPage';
import OnboardingWizard from './OnboardingWizard';
import ResearchPage from './ResearchPage';
import ListingScraperPage from './ListingScraperPage';
import BrandPage from './BrandPage';
import PipelinePage from './PipelinePage';
import OmobonoPage from './OmobonoPage';
import SchedulerPage from './SchedulerPage';
import SettingsPage from './SettingsPage';
import StudioPage from './StudioPage';

// MAS feature routes, namespaced under /mas to coexist with the inherited
// (legacy) routes. Spread into the main router's children.
export const masRoutes = [
  { path: '/mas/studio', element: <StudioPage />, meta: { name: 'Studio' } },
  {
    path: '/mas/onboarding',
    element: <OnboardingWizard />,
    meta: { name: 'Onboarding' },
  },
  {
    path: '/mas/publish',
    element: <PublishPage />,
    meta: { name: 'Publish' },
  },
  {
    path: '/mas/content',
    element: <ContentPage />,
    meta: { name: 'Generate' },
  },
  {
    path: '/mas/research',
    element: <ResearchPage />,
    meta: { name: 'Research' },
  },
  {
    path: '/mas/listings',
    element: <ListingScraperPage />,
    meta: { name: 'Listings' },
  },
  {
    path: '/mas/brand',
    element: <BrandPage />,
    meta: { name: 'Brand' },
  },
  {
    path: '/mas/analytics',
    element: <AnalyticsPage />,
    meta: { name: 'Analytics' },
  },
  {
    path: '/mas/engagement',
    element: <EngagementPage />,
    meta: { name: 'Engage' },
  },
  {
    path: '/mas/omobono',
    element: <OmobonoPage />,
    meta: { name: 'Omobono' },
  },
  {
    path: '/mas/pipeline',
    element: <PipelinePage />,
    meta: { name: 'Pipeline' },
  },
  {
    path: '/mas/scheduler',
    element: <SchedulerPage />,
    meta: { name: 'Scheduler' },
  },
  {
    path: '/mas/settings',
    element: <SettingsPage />,
    meta: { name: 'Settings' },
  },
];
