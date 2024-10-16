import React, { useState, useCallback } from "react";
import { View, Text, Button, ScrollView, Alert } from "react-native";
import * as MediaLibrary from "expo-media-library";

const BATCH_SIZE = 10;
const MAX_PHOTOS = 300;

interface PhotoStats {
  localPhotos: number;
  networkPhotos: number;
  orientations: { [key: string]: number };
  aspectRatios: { [key: string]: number };
  fileTypes: { [key: string]: number };
  creationYears: { [key: string]: number };
  timeOfDay: { [key: string]: number };
  cameraModels: { [key: string]: number };
  lensModels: { [key: string]: number };
  highestPhoto: number;
  lowestPhoto: number;
  fastestPhoto: number;
}

const initialPhotoStats: PhotoStats = {
  localPhotos: 0,
  networkPhotos: 0,
  orientations: {},
  aspectRatios: {},
  fileTypes: {},
  creationYears: {},
  timeOfDay: {},
  cameraModels: {},
  lensModels: {},
  highestPhoto: 0,
  lowestPhoto: Infinity,
  fastestPhoto: 0,
};

type ExifInfo = {
  [key: string]: any;
};

function getFileType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  const typeMap: { [key: string]: string } = {
    jpg: "JPEG",
    jpeg: "JPEG",
    png: "PNG",
    heic: "HEIC",
    gif: "GIF",
    tiff: "TIFF",
    bmp: "BMP",
  };
  return typeMap[extension] || "Unknown";
}

function getOrientation(width: number, height: number): string {
  if (width > height) return "landscape";
  if (height > width) return "portrait";
  return "square";
}

function getAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function getTimeOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const LibraryAnalyzer: React.FC = () => {
  const [stats, setStats] = useState<PhotoStats | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const processAsset = async (
    asset: MediaLibrary.Asset,
    photoStats: PhotoStats,
  ) => {
    try {
      const assetInfo = await MediaLibrary.getAssetInfoAsync(asset, {
        shouldDownloadFromNetwork: false,
      });

      if (assetInfo.isNetworkAsset) {
        photoStats.networkPhotos++;
        return;
      }

      photoStats.localPhotos++;

      // File type
      const fileType = getFileType(asset.filename);
      photoStats.fileTypes[fileType] =
        (photoStats.fileTypes[fileType] || 0) + 1;

      // Creation year
      const year = new Date(asset.creationTime).getFullYear().toString();
      photoStats.creationYears[year] =
        (photoStats.creationYears[year] || 0) + 1;

      // Time of day
      const hour = new Date(asset.creationTime).getHours();
      const timeOfDay = getTimeOfDay(hour);
      photoStats.timeOfDay[timeOfDay] =
        (photoStats.timeOfDay[timeOfDay] || 0) + 1;

      // Orientation
      const orientation = getOrientation(asset.width, asset.height);
      photoStats.orientations[orientation] =
        (photoStats.orientations[orientation] || 0) + 1;

      // Aspect ratio
      const aspectRatio = getAspectRatio(asset.width, asset.height);
      photoStats.aspectRatios[aspectRatio] =
        (photoStats.aspectRatios[aspectRatio] || 0) + 1;

      if (assetInfo.exif) {
        const exif = assetInfo.exif as ExifInfo;

        // Camera Model
        const cameraModel = exif["{TIFF}"]?.Model;
        if (typeof cameraModel === "string") {
          photoStats.cameraModels[cameraModel] =
            (photoStats.cameraModels[cameraModel] || 0) + 1;
        }

        // Lens Model
        const lensModel = exif["{Exif}"]?.LensModel;
        if (typeof lensModel === "string") {
          photoStats.lensModels[lensModel] =
            (photoStats.lensModels[lensModel] || 0) + 1;
        }

        // GPS
        const altitude = Number(exif["{GPS}"]?.Altitude);
        if (!isNaN(altitude)) {
          photoStats.highestPhoto = Math.max(photoStats.highestPhoto, altitude);
          photoStats.lowestPhoto = Math.min(photoStats.lowestPhoto, altitude);
        }

        const speed = Number(exif["{GPS}"]?.Speed);
        if (!isNaN(speed)) {
          photoStats.fastestPhoto = Math.max(photoStats.fastestPhoto, speed);
        }
      }
    } catch (assetError) {
      console.error("Error processing asset:", assetError);
    }
  };

  const analyzePhotoLibrary = useCallback(async () => {
    setProcessing(true);
    setProgress(0);
    setStats(null);

    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        throw new Error("Permission to access media library was denied");
      }

      let photoStats: PhotoStats = { ...initialPhotoStats };
      let hasNextPage = true;
      let endCursor: string | undefined;

      while (
        hasNextPage &&
        photoStats.localPhotos + photoStats.networkPhotos < MAX_PHOTOS
      ) {
        const {
          assets,
          endCursor: newEndCursor,
          hasNextPage: newHasNextPage,
        } = await MediaLibrary.getAssetsAsync({
          first: BATCH_SIZE,
          after: endCursor,
          mediaType: MediaLibrary.MediaType.photo,
          sortBy: [MediaLibrary.SortBy.creationTime],
        });

        await Promise.all(
          assets.map((asset) => processAsset(asset, photoStats)),
        );

        setStats({ ...photoStats });
        setProgress(photoStats.localPhotos + photoStats.networkPhotos);

        hasNextPage = newHasNextPage;
        endCursor = newEndCursor;
      }

      if (photoStats.localPhotos + photoStats.networkPhotos >= MAX_PHOTOS) {
        Alert.alert(
          "Analysis Limit Reached",
          `Analyzed ${MAX_PHOTOS} photos. Some photos may not be included in the stats.`,
        );
      }
    } catch (error) {
      console.error("Error analyzing photo library:", error);
      Alert.alert(
        "Error",
        "An error occurred while analyzing the photo library. Please try again.",
      );
    } finally {
      setProcessing(false);
    }
  }, []);

  return (
    <ScrollView style={{ flex: 1, padding: 20 }}>
      {!processing && !stats && (
        <Button title="Analyze Photo Library" onPress={analyzePhotoLibrary} />
      )}
      {processing && <Text>Processing... {progress} photos analyzed</Text>}
      {stats && (
        <View>
          <Text style={{ fontSize: 18, fontWeight: "bold", marginBottom: 10 }}>
            Photo Library Stats
          </Text>
          <Text>Total Photos: {stats.localPhotos + stats.networkPhotos}</Text>
          <Text>Local Photos: {stats.localPhotos}</Text>
          <Text>Network Photos: {stats.networkPhotos}</Text>
          <Text>Highest: {stats.highestPhoto.toFixed(2)} meters</Text>
          <Text>
            Lowest:{" "}
            {stats.lowestPhoto === Infinity
              ? "N/A"
              : stats.lowestPhoto.toFixed(2) + " meters"}
          </Text>
          <Text>Fastest: {stats.fastestPhoto.toFixed(2)} km/h</Text>

          <Text style={{ fontWeight: "bold", marginTop: 10 }}>File Types:</Text>
          {Object.entries(stats.fileTypes).map(([type, count]) => (
            <Text key={type}>
              {type}: {count}
            </Text>
          ))}

          <Text style={{ fontWeight: "bold", marginTop: 10 }}>
            Orientations:
          </Text>
          {Object.entries(stats.orientations).map(([orientation, count]) => (
            <Text key={orientation}>
              {orientation}: {count}
            </Text>
          ))}

          <Text style={{ fontWeight: "bold", marginTop: 10 }}>
            Top 5 Aspect Ratios:
          </Text>
          {Object.entries(stats.aspectRatios)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([ratio, count]) => (
              <Text key={ratio}>
                {ratio}: {count}
              </Text>
            ))}

          <Text style={{ fontWeight: "bold", marginTop: 10 }}>
            Top 5 Camera Models:
          </Text>
          {Object.entries(stats.cameraModels)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([model, count]) => (
              <Text key={model}>
                {model}: {count}
              </Text>
            ))}

          <Text style={{ fontWeight: "bold", marginTop: 10 }}>
            Top 5 Lens Models:
          </Text>
          {Object.entries(stats.lensModels)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([model, count]) => (
              <Text key={model}>
                {model}: {count}
              </Text>
            ))}

          <Text style={{ fontWeight: "bold", marginTop: 10 }}>
            Photos by Year:
          </Text>
          {Object.entries(stats.creationYears)
            .sort(([a], [b]) => Number(b) - Number(a))
            .map(([year, count]) => (
              <Text key={year}>
                {year}: {count}
              </Text>
            ))}

          <Text style={{ fontWeight: "bold", marginTop: 10 }}>
            Photos by Time of Day:
          </Text>
          {Object.entries(stats.timeOfDay).map(([time, count]) => (
            <Text key={time}>
              {time}: {count}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

export default LibraryAnalyzer;
