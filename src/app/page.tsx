"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

async function convertImages(file: File, format: string, setProgress: (progress: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      if (!event.target?.result) {
        reject(new Error("Failed to read the zip file."));
        return;
      }

      const zipData = event.target.result as ArrayBuffer;
      const zip = await import("jszip").then((JSZip) => new JSZip.default());

      try {
        await zip.loadAsync(zipData);

        const files = zip.file(/\.(png|jpg|jpeg|heic|gif)$/i);
        const totalFiles = files.length;
        let completedFiles = 0;

        if (totalFiles === 0) {
          reject(new Error("No supported image files found in the zip."));
          return;
        }

        for (const file of files) {
          try {
            const img = new Image();
            const blob = await file.async("blob");
            const imageUrl = URL.createObjectURL(blob);

            await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                URL.revokeObjectURL(imageUrl);
                resolve();
              };

              img.onerror = (error) => {
                URL.revokeObjectURL(imageUrl);
                reject(error);
              };

              img.src = imageUrl;
            });


            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
              console.error("Could not get canvas context");
              completedFiles++;
              setProgress((completedFiles / totalFiles) * 100);
              continue;
            }

            ctx.drawImage(img, 0, 0);

            const convertedBlob: Blob | null = await new Promise((resolve) => {
              canvas.toBlob(
                (blob) => {
                  resolve(blob);
                },
                `image/${format}`,
                0.9
              );
            });

            if (!convertedBlob) {
              console.error("Could not convert image");
              completedFiles++;
              setProgress((completedFiles / totalFiles) * 100);
              continue;
            }
            zip.remove(file.name);
            zip.file(file.name.substring(0, file.name.lastIndexOf('.')) + `.${format}`, convertedBlob);
          } catch (error: any) {
            console.error(`Error converting ${file.name}: ${error?.message || 'Unknown error'}`);
          } finally {
            completedFiles++;
            setProgress((completedFiles / totalFiles) * 100);
          }
        }

        const outputZipBlob = await zip.generateAsync({ type: "blob" });
        resolve(outputZipBlob);
      } catch (error: any) {
        reject(new Error(`Zip processing failed: ${error.message}`));
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read the file."));
    };

    reader.readAsArrayBuffer(file);
  });
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState("jpeg");
  const [progress, setProgress] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files && event.target.files[0];
    setFile(selectedFile);
  };

  const handleFormatChange = (format: string) => {
    setFormat(format);
  };

  const convert = useCallback(async () => {
    if (!file) {
      toast({
        title: "Error",
        description: "Please select a zip file.",
        variant: "destructive",
      });
      return;
    }

    setIsConverting(true);
    setProgress(0);

    try {
      const convertedZipBlob = await convertImages(file, format, setProgress);

      const url = URL.createObjectURL(convertedZipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `converted.${format}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Zip file converted successfully!",
      });
      setFile(null);
    } catch (error: any) {
      toast({
        title: "Conversion Error",
        description: error.message || "Failed to convert zip file.",
        variant: "destructive",
      });
    } finally {
      setIsConverting(false);
      setProgress(0);
    }
  }, [file, format, toast]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <h1 className="text-2xl font-semibold mb-4">Zip Image Converter</h1>
      <div className="flex flex-col gap-4 w-full max-w-md">
        <div>
          <Label htmlFor="zip-file">Upload Zip File:</Label>
          <Input id="zip-file" type="file" accept=".zip" onChange={handleFileChange} disabled={isConverting} />
        </div>

        <div>
          <Label htmlFor="format">Output Format:</Label>
          <Select onValueChange={handleFormatChange} defaultValue={format}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="jpeg">JPEG</SelectItem>
              <SelectItem value="png">PNG</SelectItem>
              <SelectItem value="webp">WEBP</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={convert} disabled={isConverting || !file}>
          {isConverting ? "Converting..." : "Convert to " + format.toUpperCase()}
        </Button>

        {isConverting && (
          <div className="w-full">
            <Progress value={progress} />
            <p className="text-sm text-muted-foreground mt-1 text-center">
              {progress.toFixed(1)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

