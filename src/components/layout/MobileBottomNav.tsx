import React from 'react';
import {
  Activity,
  CalendarCheck,
  MapPin,
  MessageSquare,
  Sparkles,
  Stethoscope,
} from 'lucide-react';

interface MobileBottomNavProps {
  activeTab: 'home' | 'chat' | 'assessment' | 'clinics' | 'doctors' | 'bookings' | 'history';
  setActiveTab: (tab: 'home' | 'chat' | 'assessment' | 'clinics' | 'doctors' | 'bookings' | 'history') => void;
  hasActiveAssessment: boolean;
  upcomingBookingsCount: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  setActiveTab,
  hasActiveAssessment,
  upcomingBookingsCount,
}) => {
  const navItems = [
    { id: 'home', label: 'Home', icon: Sparkles },
    { id: 'chat', label: 'AI Intake', icon: MessageSquare, isPrimary: true },
    ...(hasActiveAssessment
      ? [{ id: 'assessment', label: 'Assessment', icon: Activity, isSpecial: true }]
      : []),
    { id: 'clinics', label: 'Clinics', icon: MapPin },
    { id: 'doctors', label: 'Doctors', icon: Stethoscope },
    { id: 'bookings', label: 'Bookings', icon: CalendarCheck, badge: upcomingBookingsCount },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-zinc-200/90 safe-bottom lg:hidden shadow-[0_-2px_12px_rgba(0,0,0,0.06)] transition-all duration-200"
    >
      <div className="flex items-center justify-around px-1 py-1.5 h-16 max-w-lg mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          if (item.isPrimary && !hasActiveAssessment) {
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className="relative flex flex-col items-center justify-center -mt-3.5 group cursor-pointer focus:outline-hidden"
              >
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-md transition-transform active:scale-90 ${
                    isActive
                      ? 'bg-teal-600 text-white ring-4 ring-teal-100 shadow-teal-500/25'
                      : 'bg-zinc-900 text-teal-300 ring-2 ring-zinc-800'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span
                  className={`text-[10px] font-bold mt-0.5 tracking-tight ${
                    isActive ? 'text-teal-700 font-extrabold' : 'text-zinc-600'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`relative flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all duration-150 min-w-[54px] active:scale-95 cursor-pointer focus:outline-hidden ${
                isActive ? 'text-teal-700' : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon
                  className={`h-5 w-5 transition-transform ${
                    isActive ? 'scale-110 text-teal-600 stroke-[2.25]' : 'text-zinc-400 stroke-[1.75]'
                  }`}
                />
                {Boolean(item.badge && item.badge > 0) && (
                  <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-teal-600 text-[9px] font-bold text-white shadow-xs">
                    {item.badge}
                  </span>
                )}
                {item.isSpecial && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white animate-pulse" />
                )}
              </div>
              <span
                className={`text-[10px] mt-1 tracking-tight leading-none ${
                  isActive ? 'font-bold text-teal-800' : 'font-medium text-zinc-500'
                }`}
              >
                {item.label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 h-0.5 w-6 rounded-full bg-teal-600" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
