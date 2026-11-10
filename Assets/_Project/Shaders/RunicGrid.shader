// Grade dourada para os planos detectados durante o escaneamento da mesa (URP, unlit, transparente).
// A grade é desenhada em coordenadas de mundo (XZ), então não "escorrega" quando o plano cresce.
Shader "MtgAr/RunicGrid"
{
    Properties
    {
        _Color ("Cor da linha", Color) = (0.902, 0.761, 0.478, 1)
        _FillAlpha ("Preenchimento", Range(0, 1)) = 0.08
        _CellSize ("Tamanho da célula (m)", Float) = 0.05
        _LineWidth ("Espessura (fração da célula)", Range(0.005, 0.2)) = 0.04
        _Reveal ("Revelação", Range(0, 1)) = 1
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Transparent" "RenderPipeline" = "UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                half _FillAlpha;
                float _CellSize;
                half _LineWidth;
                half _Reveal;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD0; float2 uv : TEXCOORD1; };

            Varyings vert (Attributes input)
            {
                Varyings o;
                o.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                o.positionCS = TransformWorldToHClip(o.positionWS);
                o.uv = input.uv;
                return o;
            }

            half4 frag (Varyings i) : SV_Target
            {
                float2 cell = i.positionWS.xz / _CellSize;
                float2 dist = abs(frac(cell - 0.5) - 0.5);
                float2 aa = fwidth(cell);
                float2 lines = 1.0 - smoothstep(_LineWidth, _LineWidth + aa, dist);
                half gridLine = max(lines.x, lines.y);

                // Pontinho no centro de cada célula, como as "runas" do protótipo.
                half rune = 1.0 - smoothstep(0.06, 0.06 + max(aa.x, aa.y), length(frac(cell) - 0.5));

                half alpha = saturate(_FillAlpha + gridLine * 0.6 + rune * 0.5) * _Color.a * _Reveal;
                return half4(_Color.rgb, alpha);
            }
            ENDHLSL
        }
    }
}
