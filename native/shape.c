/* Browser-only RootSIFT extraction and approximate descriptor retrieval.
 * VLFeat is BSD licensed; see vlfeat/COPYING. No image leaves the browser. */
#include "vl/sift.h"
#include "vl/kdtree.h"
#include "vl/random.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* The vendored generic.c enables VLFeat's constructor for Emscripten. */

typedef struct { VlSiftKeypoint key; float response; } Key;
typedef struct { float x,y,scale,angle,response; uint8_t descriptor[128]; } Feature;
static int key_order(const void *a,const void *b) {
  float x=((const Key*)a)->response,y=((const Key*)b)->response; return (x<y)-(x>y);
}
static int feature_order(const void *a,const void *b) {
  float x=((const Feature*)a)->response,y=((const Feature*)b)->response; return (x<y)-(x>y);
}

int lace_extract(const float *image,int width,int height,int maximum,float min_sigma,float *points,uint8_t *descriptors) {
  if(width<16||height<16||maximum<1||maximum>2000) return 0;
  VlSiftFilt *filter=vl_sift_new(width,height,-1,3,0);
  if(!filter) return -1;
  vl_sift_set_peak_thresh(filter,1.0); vl_sift_set_edge_thresh(filter,16);
  int capacity=maximum*16,count=0;
  Feature *features=malloc(sizeof(Feature)*capacity);
  if(!features){vl_sift_delete(filter);return -1;}
  int status=vl_sift_process_first_octave(filter,image);
  while(!status) {
    vl_sift_detect(filter);
    int n=vl_sift_get_nkeypoints(filter),used=0;
    Key *keys=malloc(sizeof(Key)*(n?n:1));
    const VlSiftKeypoint *source=vl_sift_get_keypoints(filter);
    int ow=filter->octave_width,oh=filter->octave_height;
    for(int i=0;i<n;i++) {
      const VlSiftKeypoint *key=source+i;
      if(key->sigma<min_sigma||key->x<12||key->y<12||key->x>width-12||key->y>height-12)continue;
      keys[used].key=*key;
      keys[used].response=fabsf(filter->dog[(key->is-filter->s_min)*ow*oh+key->iy*ow+key->ix]);
      used++;
    }
    qsort(keys,used,sizeof(Key),key_order);
    if(used>maximum)used=maximum;
    for(int i=0;i<used&&count<capacity;i++) {
      double angles[4]; int na=vl_sift_calc_keypoint_orientations(filter,angles,&keys[i].key);
      for(int j=0;j<na&&j<2&&count<capacity;j++) {
        float descriptor[128],sum=0; Feature *feature=features+count++;
        vl_sift_calc_keypoint_descriptor(filter,descriptor,&keys[i].key,angles[j]);
        for(int k=0;k<128;k++)sum+=descriptor[k];
        for(int k=0;k<128;k++){float value=sum>0?sqrtf(descriptor[k]/sum)*512:0;feature->descriptor[k]=(uint8_t)fminf(255,roundf(value));}
        feature->x=keys[i].key.x;feature->y=keys[i].key.y;feature->scale=keys[i].key.sigma;feature->angle=angles[j];feature->response=keys[i].response;
      }
    }
    free(keys);status=vl_sift_process_next_octave(filter);
  }
  qsort(features,count,sizeof(Feature),feature_order);
  if(count>maximum)count=maximum;
  for(int i=0;i<count;i++){
    points[4*i]=features[i].x;points[4*i+1]=features[i].y;points[4*i+2]=features[i].scale;points[4*i+3]=features[i].angle;
    memcpy(descriptors+128*i,features[i].descriptor,128);
  }
  free(features);vl_sift_delete(filter);return count;
}

typedef struct { VlKDForest *forest; float *data; int count; } Index;
Index *lace_index(const uint8_t *descriptors,int count,int trees) {
  if(count<1||count>2000000)return NULL;
  Index *index=calloc(1,sizeof(Index)); if(!index)return NULL;
  index->data=malloc(sizeof(float)*128*count);if(!index->data){free(index);return NULL;}
  for(int i=0;i<count*128;i++)index->data[i]=descriptors[i]/512.f;
  vl_rand_seed(vl_get_rand(),13579);
  index->forest=vl_kdforest_new(VL_TYPE_FLOAT,128,trees,VlDistanceL2);
  index->count=count;vl_kdforest_build(index->forest,count,index->data);return index;
}
void lace_index_delete(Index *index) {if(index){vl_kdforest_delete(index->forest);free(index->data);free(index);}}
void lace_query(Index *index,const uint8_t *descriptors,int count,int neighbours,int checks,uint32_t *ids,float *distances) {
  if(!index||count<1||neighbours<1||neighbours>index->count)return;
  float *query=malloc(sizeof(float)*128*count);if(!query)return;
  for(int i=0;i<count*128;i++)query[i]=descriptors[i]/512.f;
  vl_kdforest_set_max_num_comparisons(index->forest,checks);
  vl_kdforest_query_with_array(index->forest,ids,neighbours,count,distances,query);
  free(query);
}
