import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ArrowLeft, Apple } from 'lucide-react';
import NutritionHydration from '../../components/NutritionHydration';

export default function Nutrition() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background" data-testid="nutrition-page">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/athlete')}
            data-testid="back-btn"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-lime-500/20 flex items-center justify-center">
              <Apple className="w-5 h-5 text-lime-400" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg">Nutrition & Hydration</h1>
              <p className="text-xs text-muted-foreground">Personalized macros and hydration</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6">
        <NutritionHydration />
      </main>
    </div>
  );
}
