import { useState } from 'react';
import { cn } from '../../lib/utils';

function Tabs({ defaultValue, className, children }) {
  const [activeTab, setActiveTab] = useState(defaultValue);

  return (
    <div className={cn('w-full', className)}>
      {children.map((child) => {
        if (child.type === TabsList) {
          return (
            <child.type
              key="tabs-list"
              {...child.props}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          );
        }
        if (child.type === TabsContent) {
          return (
            <child.type
              key={child.props.value}
              {...child.props}
              isActive={activeTab === child.props.value}
            />
          );
        }
        return child;
      })}
    </div>
  );
}

function TabsList({ className, children, activeTab, onTabChange }) {
  return (
    <div className={cn('inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground', className)}>
      {children.map((child) => (
        <child.type
          key={child.props.value}
          {...child.props}
          isActive={activeTab === child.props.value}
          onClick={() => onTabChange(child.props.value)}
        />
      ))}
    </div>
  );
}

function TabsTrigger({ value, className, children, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
        className
      )}
    >
      {children}
    </button>
  );
}

function TabsContent({ value, className, children, isActive }) {
  if (!isActive) return null;

  return (
    <div className={cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)}>
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };