import 'dart:io';
import 'dart:math';
import 'package:image/image.dart' as img;
import 'package:tflite_flutter/tflite_flutter.dart';

/// Computes a face embedding on-device using a MobileFaceNet TFLite model.
/// The model outputs a 192-d (or 128-d) vector; we L2-normalize it.
///
/// Add the model to assets/mobilefacenet.tflite (see README). A real pipeline
/// also crops/aligns the detected face before embedding for best accuracy.
class FaceEmbedder {
  Interpreter? _interpreter;
  int _inputSize = 112; // MobileFaceNet expects 112×112

  Future<void> load() async {
    _interpreter ??= await Interpreter.fromAsset('assets/mobilefacenet.tflite');
  }

  /// Returns an L2-normalized embedding for a face image file, or null on error.
  Future<List<double>?> embedFile(String path) async {
    await load();
    final interp = _interpreter;
    if (interp == null) return null;

    final raw = img.decodeImage(await File(path).readAsBytes());
    if (raw == null) return null;
    final face = img.copyResize(raw, width: _inputSize, height: _inputSize);

    // [1,112,112,3] normalized to [-1,1]
    final input = List.generate(
      1,
      (_) => List.generate(
        _inputSize,
        (y) => List.generate(_inputSize, (x) {
          final p = face.getPixel(x, y);
          return [
            (p.r - 127.5) / 128.0,
            (p.g - 127.5) / 128.0,
            (p.b - 127.5) / 128.0,
          ];
        }),
      ),
    );

    final outDim = interp.getOutputTensor(0).shape.last;
    final output = List.generate(1, (_) => List.filled(outDim, 0.0));
    interp.run(input, output);

    final vec = output[0];
    final norm = sqrt(vec.fold<double>(0, (s, v) => s + v * v));
    if (norm == 0) return vec;
    return vec.map((v) => v / norm).toList();
  }
}
