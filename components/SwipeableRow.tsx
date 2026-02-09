import React, { useRef, useState } from "react";
import { Pressable, Platform, View } from "react-native";
import { Text } from "@/components/ui/text";

export interface SwipeAction {
  label: string;
  icon?: React.ComponentType<{ size: number; color: string }>;
  color: string;
  onPress: () => void;
}

interface SwipeableRowProps {
  actions: SwipeAction[];
  children: React.ReactNode;
}

function WebRow({ actions, children }: SwipeableRowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <View
      className="relative"
      // @ts-expect-error - web-only mouse events
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && actions.length > 0 && (
        <View className="absolute right-2 top-0 bottom-0 flex-row items-center gap-1">
          {actions.map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              className="h-8 w-8 items-center justify-center rounded-md"
              style={{ backgroundColor: action.color }}
            >
              {action.icon && (
                <action.icon size={16} color="#fff" />
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function NativeRow({ actions, children }: SwipeableRowProps) {
  const swipeableRef = useRef<any>(null);

  // Lazy-load to avoid importing on web
  const ReanimatedSwipeable =
    require("react-native-gesture-handler/ReanimatedSwipeable").default;

  const renderRightActions = () => (
    <View className="flex-row">
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={() => {
            action.onPress();
            swipeableRef.current?.close();
          }}
          className="w-[75px] items-center justify-center"
          style={{ backgroundColor: action.color }}
        >
          {action.icon && <action.icon size={20} color="#fff" />}
          <Text className="mt-1 text-xs font-medium text-white">
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      rightThreshold={40}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

export function SwipeableRow(props: SwipeableRowProps) {
  if (Platform.OS === "web") {
    return <WebRow {...props} />;
  }
  return <NativeRow {...props} />;
}
